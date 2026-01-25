import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

function ultraSlimIngredients(product) {
  const arr = Array.isArray(product?.ingredients) ? product.ingredients : [];
  return arr
    .map((ing) => {
      const id = ing?.id;
      const p = typeof ing?.percent_estimate === "number" ? ing.percent_estimate : null;
      if (!id) return null;
      return p === null ? id : `${id}:${p}`;
    })
    .filter(Boolean);
}

function pickNutrients(nutriments = {}) {
  const keys = [
    "added-sugars_100g",
    "proteins_100g",
    "fiber_100g",
    "fat_100g",
  ];

  const result = {};

  for (const key of keys) {
    if (typeof nutriments[key] === "number") {
      result[key] = nutriments[key];
    }
  }

  return result;
}


app.post("/barcode", async (req, res) => {
  try {
    const { barcode } = req.body;

    if (!barcode) {
      return res.status(400).json({ error: "barcode is required" });
    }

    const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;

    const r = await fetch(url, {
      headers: {
        "User-Agent": "EatLessLab/1.0 (contact: you@example.com)",
      },
    });

    if (!r.ok) {
      return res.status(502).json({ error: "OpenFoodFacts error" });
    }

    const data = await r.json();

    if (data.status !== 1 || !data.product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const p = data.product;
    filter= ultraSlimIngredients(p.ingredients);
    nutri_filter=pickNutrients(p.nutriments) 
    console.log(p.product_name_en);
    console.log(p.nutriscore_grade);
    console.log(filter);
    console.log(nutri_filter);


    res.json({
      product_name_en: p.product_name_en || p.product_name || null,
      nutriscore_grade: p.nutriscore_grade || null,
      nutriments: nutri_filter || {},
      ingredients: filter || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/summary", async (req, res) => {
  try {
     const systemInstruction = `
FOOD PRODUCT EVALUATION RULES

You evaluate food products for a consumer app.
Your goal is NOT to classify food by type, but to decide whether a product is something the body would be better off limiting as much as possible.

Do not rely on food categories.
Do not assume something is okay because it is common.

CORE QUESTION (MANDATORY)
Is this something I should limit as much as possible?

NUTRI-SCORE OVERRIDE (MANDATORY)
You will receive a Nutri-Score (A, B, C, D, or E).

This score OVERRIDES all reasoning.
You MUST choose the verdict exactly as follows:

- Nutri-Score A, B or C → "No real concern"
- Nutri-Score D → "Worth limiting"
- Nutri-Score E → "Best kept rare"

No alternative verdict is allowed.

INSIGHTS RULE (CRITICAL)
You will be provided ingredients with percentages and the Nutri-Score.

The verdict is locked by the Nutri-Score.
The 4 insights MUST support that verdict.

You MUST NOT:
- Say "No real concern" and then describe the product as unhealthy
- Contradict the verdict in any way
- Soften or override the Nutri-Score decision

OUTPUT FORMAT (STRICT JSON ONLY)
Return ONLY valid JSON. No extra text.

{
  "verdict": "No real concern | Worth limiting | Best kept rare",
  "insights": [
    "What this product mostly is",
    "What (if anything) balances it",
    "The recognizable consumption pattern",
    "Why regular use would or wouldn’t be an issue"
  ]
}
`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.API_OPENAI}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: systemInstruction },
          {
            role: "user",
            content: JSON.stringify(req.body)
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    res.json(data.output_text);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
