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
      const id = ing?.id;
      const p =
        typeof ing?.percent_estimate === "number" ? ing.percent_estimate : null;
      if (!id) return null;
      return p === null ? id : `${id}:${p}`;
    })
    .filter(Boolean);
}

function pickNutrients(nutriments = {}) {
  const keys = ["added-sugars_100g", "proteins_100g", "fiber_100g", "fat_100g"];
  const result = {};
  for (const key of keys) {
    if (typeof nutriments[key] === "number") result[key] = nutriments[key];
  }
  return result;
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

    const ingredients = ultraSlimIngredients(p);
    const nutrients = pickNutrients(p.nutriments);

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
- Ingredients with percentages
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

You will receive the age of the child or children.
You MUST take the age into account in your explanations
and clearly reference age relevance when appropriate.

ALLERGY RULE (CRITICAL)

If the allergies field is NOT "none":
You MUST clearly state at the VERY BEGINNING
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

1️. ✅ What’s in it  
Explain what the child is mostly getting (simple, real food focus).

2. 🧠 Why this works for children  
Explain satiety, steady energy, or habit support.

3️. 📊 Clear summary  
One short sentence explaining why this fits daily eating.

---
IF verdict = "Okay sometimes"

 1️. ✅ What’s fine about it  
Highlight what’s acceptable and why it’s okay to enjoy occasionally.

2. 🕒 Why this is better sometimes  
Briefly explain why it’s not ideal as a daily choice but still good to consume,
in a calm, non-judgmental way.

3️. 📊 Clear summary  
One short sentence explaining when it fits.

---
IF verdict = "Best kept rare"

1️. 🔍 What’s not the main issue  
Acknowledge what looks fine or acceptable.

2. ⚠️ Main issues for children  
Explain the key reasons this is unsuitable for regular use.
3️.📊 Clear summary  
One clear sentence explaining why this should be rare.
---

LANGUAGE RULES
- Always refer to children / your child
- No medical claims
- No scare language
- No nutrition scores mentioned
- No contradictions
---

OUTPUT (STRICT JSON ONLY )

{
"tagline": "string",
  "verdict": "Good for everyday | Okay sometimes | Best kept rare",
  "sections": [
    { "title": "...", "text": "..." },
    { "title": "...", "text": "..." },
    { "title": " Clear summary", "text": "..." }
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

    res.json({
      product_name_en: p.product_name_en || p.product_name || null,
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






