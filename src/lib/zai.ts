import ZAI from 'z-ai-web-dev-sdk'

/**
 * z-ai ইঞ্জিন (ফলব্যাক):
 * Gemini কী না থাকলে / জিও-ব্লকড হলে / রেট-লিমিটে গেলে —
 * স্টুডেন্ট যেন কখনো খালি হাতে না ফেরে। শুধু ব্যাকএন্ডে ব্যবহারযোগ্য।
 */

type ZAIInstance = Awaited<ReturnType<typeof ZAI.create>>
let instance: ZAIInstance | null = null

async function getZai(): Promise<ZAIInstance> {
  if (!instance) instance = await ZAI.create()
  return instance
}

export async function zaiChat(system: string, prompt: string): Promise<string> {
  const zai = await getZai()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content: prompt },
    ],
    thinking: { type: 'disabled' },
  })
  const text = completion.choices[0]?.message?.content ?? ''
  if (!text.trim()) throw new Error('ZAI_EMPTY_RESPONSE')
  return text
}
