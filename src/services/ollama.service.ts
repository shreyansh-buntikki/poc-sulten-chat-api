type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class OllamaService {
  private baseUrl: string;
  private chatModel: string;
  private embedModel: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    this.chatModel = process.env.OLLAMA_CHAT_MODEL || "gemma3:latest";
    this.embedModel =
      process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text:latest";
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.embedModel, prompt: text }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama embeddings error: ${res.status} ${errText}`);
    }
    const json = (await res.json()) as { embedding: number[] };
    return json.embedding;
  }

  async chat(messages: OllamaChatMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.chatModel, messages, stream: false }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama chat error: ${res.status} ${errText}`);
    }
    const json = (await res.json()) as {
      message: { role: string; content: string };
    };
    return json.message?.content || "";
  }
}
