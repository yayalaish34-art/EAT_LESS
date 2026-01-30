import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

function ultraSlimIngredients(product) {
  const arr = Array.isArray(product?.ingredients) ? product.ingredients : [];
  return arr
    .map((ing) => {
      const rawId = ing?.id;
      const p =
        typeof ing?.percent_estimate === "number" ? ing.percent_estimate : null;
      if (!rawId) return null;

      // remove language prefix like "en:"
      const id = String(rawId).replace(/^[a-z]{2}:/i, "");

      return p === null ? id : `${id}:${p}`;
    })
    .filter(Boolean);
}

function normalizeIngredientTokens(tokens) {
  return (Array.isArray(tokens) ? tokens : []).map((t) => {
    const s = String(t ?? "");

    // keep the first char if it's "!" or "-"
    const prefix = s[0] === "!" || s[0] === "-" ? s[0] : "";
    const rest = prefix ? s.slice(1) : s;

    // replace internal hyphens with spaces, collapse spaces, keep order
    const normalized = rest.replace(/-/g, " ").replace(/\s+/g, " ").trim();

    return prefix + normalized;
  });
}
function normalizeIngredients(ingredientsText) {
  if (!ingredientsText || typeof ingredientsText !== "string") return [];

  return ingredientsText
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      // אם יש prefix כמו "emulsifier:"
      const parts = item.split(":");
      return parts.length > 1 ? parts.slice(1).join(":").trim() : item;
    })
    .filter(item => {
      // מסנן הצהרות כמו "contains:"
      return !item.toLowerCase().includes("minimum");
    });
}

function extractJsonFromResponsesApi(respJson) {
  const content = respJson?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Missing content from OpenAI");
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    console.error("Raw OpenAI content:", content);
    throw new Error("Invalid JSON returned from AI");
  }
}

app.post("/barcode", async (req, res) => {
  try {
  const { barcode, children, allergies = "none", goal = null } = req.body;

    if (!barcode) return res.status(400).json({ error: "barcode is required" });

    const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;

    const r = await fetch(url, {
      headers: { "User-Agent": "EatLessLab/1.0 (contact: you@example.com)" },
    });

    if (!r.ok) return res.status(502).json({ error: "OpenFoodFacts error" });

    const data1 = await r.json();
    if (data1?.status !== 1 || !data1?.product)
      return res.status(404).json({ error: "Product not found" });

    const p = data1.product;

    const ingredients = normalizeIngredients(p.ingredients_text);

    const payload = {
      product: p.product_name_en,
      ingredients,
      nutri_score: p.nutriscore_grade ?? null,
      nutrient_levels: p.nutrient_levels ?? null, // אם אתה רוצה “nutri level” אמיתי מ-OFF
      children_age: children ?? null,
      allergies,
      goal,
    };

    const systemInstruction = `You evaluate food products for a child-focused app (ages 1–13).

Your goal is to help parents understand how often a product fits
into a child’s everyday eating and development.
Focus on habits, taste, satiety, and routine.
Do NOT use calorie or diet language.
Do NOT judge parents.

---
INPUT YOU WILL RECEIVE
- Ingredients
- Nutri-Score (A–E)
- Allergies list (or "none")
- age of the child

---
Return an additional field: tagline
Type: string

Rules: 3–7 words, lowercase/clean, no brand names, no emojis, no period.

Examples:
"sweetener-rich, low-calorie cola"
"high-protein caramel pudding"
"ultra-salty refined wheat snack"
---
CORE QUESTION
How often does this product fit into a child’s eating?

---
NUTRI-SCORE OVERRIDE (MANDATORY)

You MUST apply the Nutri-Score as follows:

- Nutri-Score A → verdict MUST be "Good for everyday"
- Nutri-Score C, D, or E → YOU choose between:
  "Good for everyday" / "Okay sometimes" / "Best kept rare"

The Nutri-Score has priority over all other reasoning.

---
age of the children (CRITICAL)

You WILL receive the child’s age.
Most paragraphs MUST explicitly reference the child’s age (e.g. “for a 4-year-old”, “at this age”, “for a child around age 7”).
Explanations must match developmental stage (taste, habits, satiety, routine).


ALLERGY RULE (CRITICAL)

If the allergies field is NOT "none":
You MUST clearly state it as part of the sction at the VERY BEGINNING.
that the product CONTAINS the specified allergen(s).

This notice must appear before any other content.

---
VERDICT OPTIONS (ONLY THESE)
- "Good for everyday"
- "Okay sometimes"
- "Best kept rare"

---
STRUCTURE RULE (MANDATORY)

Return EXACTLY 3 sections.
The content MUST change based on the verdict.

---
IF verdict = "Good for everyday"

What’s in it (3 sentences)
Explain what the child is mostly getting, framed for a child of this age.
Focus on simple foods and familiarity, using age-appropriate language.

Why this works for children (3 sentences)
Explain why this fits a child of this age in terms of satiety, steady energy, and daily habits.
Mention how it supports routine eating at this stage of development.

IF verdict = "Okay sometimes"

What’s fine about it (3 sentences)
Highlight what’s acceptable for a child of this specific age.
Explain why it’s reasonable to enjoy occasionally at this age, without overemphasis.

Why this is better sometimes (3 sentences)
Explain calmly why this isn’t ideal for everyday eating for a child of this age,
but still fits naturally into an occasional routine.

IF verdict = "Best kept rare"

What’s not the main issue (3 sentences)
Acknowledge what looks fine or acceptable for a child of this age.
Keep the tone reassuring and age-aware.

Main issues for children (3 sentences)
Explain the key reasons this is unsuitable for regular use for a child at this age.
Focus on habits, taste development, and routine — not fear or restriction.
---

NEW: INGREDIENT MARKING (MANDATORY)

1. Rules:
-Always return ingredient names in English, regardless of the input language.
- Return an ARRAY of ingredient names, in the SAME ORDER as they appear.
- Split combined ingredients into separate items when clearly listed (e.g. "vegetable oils (palm, rapeseed)" → "Palm oil", "Rapeseed oil").
- If an ingredient category contains sub-ingredients in parentheses, extract the sub-ingredients only.
- Remove percentages, quantities, and numbers.
- Remove allergen emphasis (capital letters).
- Ignore regulatory statements such as "may contain", "possible traces of", or similar.
- Do NOT include allergen warnings or trace statements in the output.
- Keep names short, human-friendly, and suitable for UI chips (2–4 words max).
- Preserve the original meaning of each ingredient.
- Output ONLY a JSON array of strings. No explanations.


You MUST return a field called "ingredients_marked".

2.
For each ingredient string:
- If it is a key driver issue for children in this product → prefix it with "!"
- Otherwise → prefix it with "-"
-If an ingredient matches the allergy input, it MUST be prefixed with "!" regardless of verdict rules.

VERDICT-DEPENDENT RULES (CRITICAL):
- If verdict = "Good for everyday":
  - ALL items MUST start with "-"
  - You MUST NOT use "!" at all.

- If verdict = "Okay sometimes":
  - You MUST use "!" on ONLY 1–2 items total (choose the most relevant ones).
  - All other items MUST start with "-".
  - Do NOT over-flag.

- If verdict = "Best kept rare":
  - You SHOULD use "!" on a small set of the most important drivers (typically 1-3),
    but do NOT mark everything.
  - All remaining items MUST start with "-".

Rules:
- After the prefix ("!" or "-"), return ONLY the ingredient name.
- Remove any percentage or numeric value.
- Keep the original ingredient order exactly as in the input.
- Do NOT add any extra text.

Examples:
"!sugar"
"-wheat-flour"
"-yeast-extract"
  ---
LANGUAGE RULES
- Always frame guidance from a parent-first perspective, with the child in mind.
- No medical claims
- No scare language
- No nutrition scores mentioned
- No contradictions
- Dont use any number (e.g 1. or 2.) before a section!
---

OUTPUT (STRICT JSON ONLY )

{
"tagline": "string",
  "verdict": "Good for everyday | Okay sometimes | Best kept rare",
  "ingredients_marked": ["string"],
  "sections": [
    { "title": "...", "text": "..." },
    { "title": "...", "text": "..." },
  ]
}`; // השאר את הפרומפט שלך כמו שהוא

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.API_OPENAI}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: JSON.stringify(payload) },
        ],
        // Better for Responses API:
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: "OpenAI error", detail: errText });
    }

    const respJson = await response.json();
    const llm = extractJsonFromResponsesApi(respJson);
    const ingredients_final_mark = normalizeIngredientTokens(llm.ingredients_marked);

    res.json({
      ingredients_marked : ingredients_final_mark,
      product_name_en: p.product_name_en || p.product_name || null,
      tagline: llm.tagline || null,
      verdict: llm.verdict,
      sections: llm.sections,
      image: p.image_front_url || p.image_url || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));






