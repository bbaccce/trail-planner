import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const REGION_PROMPTS: Record<string, string> = {
  orlicke: `You are an expert hiking guide for Orlické hory (Eagle Mountains) in Czech Republic, with deep knowledge of trails around Frýdlant nad Orlicí, Říčky v Orlických horách, Deštné v Orlických horách, Zdobnice, Rokytnice v Orlických horách, and Šerlich.`,
  brno: `You are an expert hiking guide for the Brno region in Czech Republic, with deep knowledge of trails within 40 km of Brno city centre. Key areas include: Moravský kras (Macocha abyss, Punkva caves area), Podyjí National Park (Znojmo area), Litenčické vrchy, Ždánický les, Chřiby hills, Bílé Karpaty foothills, Pálava hills (UNESCO biosphere), Blanský les, and the Brno reservoir (Brněnská přehrada) surroundings.`,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { dist, elev, dur, diff, vibes, extra, region = "orlicke" } = req.body;

  if (!dist || !elev || !dur) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const regionPrompt = REGION_PROMPTS[region] ?? REGION_PROMPTS.orlicke;

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const prompt = `${regionPrompt}

User preferences:
- Distance: ~${dist} km
- Elevation gain: ~${elev} m
- Duration: ~${dur} hours
- Difficulty: ${diff}
- Wants: ${Array.isArray(vibes) ? vibes.join(", ") : "general hiking"}
- Notes: ${extra || "none"}
- Today: ${today}

Use web search to find:
1. Current trail conditions in the area (snow, mud, seasonal closures)
2. Recent hiker reports for this season

Then recommend 2-3 specific trails matching these preferences. For each trail include:
- Czech trail name and starting village/trailhead
- Exact distance, elevation gain, estimated time
- Trail marker colour (zelená/modrá/červená/žlutá značka)
- What makes it special — specific viewpoints, landmarks, mountain huts (boudy)
- Current conditions worth knowing

Be specific with real Czech trail names and waypoints. Practical and concise.`;

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const stream = await anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      tools: [
        { type: "web_search_20250305", name: "web_search" },
      ] as Parameters<typeof anthropic.messages.stream>[0]["tools"],
      messages: [{ role: "user", content: prompt }],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  }
}
