import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";
import { openai } from "eve/models/openai";

// Direct provider by whichever key is set: ANTHROPIC_API_KEY first, then
// OPENAI_API_KEY. Otherwise the AI Gateway model id (needs AI_GATEWAY_API_KEY
// or a linked Vercel project). `/model` switches it at runtime.
export default defineAgent({
  model: process.env.ANTHROPIC_API_KEY?.trim()
    ? anthropic()
    : process.env.OPENAI_API_KEY?.trim()
      ? openai("gpt-6-luna") // the helper's default, gpt-6-luna-fast, isn't on every key
      : "anthropic/claude-sonnet-5",
});
