const { answerWithLlm, answerWithoutLlm, getConfig, loadServices } = require("../lib/meadow-vet");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const message = String(body.message || "").trim();

    if (!message) {
      res.status(400).json({ error: "A message is required." });
      return;
    }

    const services = await loadServices();

    if (!getConfig().openAiApiKey) {
      const fallbackReply = answerWithoutLlm(message, services);
      res.status(200).json({
        reply: `${fallbackReply}\n\nNote: add OPENAI_API_KEY to switch this to natural-language LLM responses.`,
        mode: "fallback",
      });
      return;
    }

    const reply = await answerWithLlm(message, services);
    res.status(200).json({ reply, mode: "llm" });
  } catch (error) {
    res.status(500).json({ error: "Could not generate reply.", detail: error.message });
  }
};
