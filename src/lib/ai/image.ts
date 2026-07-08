// Marble / product visualization ("النفق السحري").
//
// Two modes (scene = FIRST image, product/marble = SECOND image reference):
//   • 'surface' — retexture the chosen surface(s) with the stone.
//   • 'place'   — intelligently INSERT the product into the scene.
// Both keep the rest of the scene unchanged.
//
// Two providers, chosen PER RENDER (provider/model/quality on the input):
//   • OpenAI  — images.edit (gpt-image-1 / 1.5 / 2).
//   • Gemini  — generateContent image output (Nano Banana family).
// Each resolves its own key, independent of the global ai_settings provider.

import OpenAI, { toFile } from 'openai'
import { GoogleGenAI } from '@google/genai'
import { getOpenAiKey, getGeminiKey } from './config'
import type { ImageProvider, ImageQuality } from './image-models'

const OPENAI_DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'

// Only gpt-image-1 / gpt-image-1.5 accept input_fidelity (gpt-image-2 rejects it
// — it is high-fidelity by default). Gate it, and retry without it on reject.
function supportsInputFidelity(model: string): boolean {
  return model === 'gpt-image-1' || model === 'gpt-image-1.5'
}

// Precise spatial description per surface key, so the model targets the exact
// region AND covers it fully. The bare key ("wall") used to leave gaps on the
// left/right; spelling out "edge to edge, floor line to ceiling line" fixes it.
const SURFACE_DESC: Record<string, string> = {
  floor:      'the floor / ground surface',
  stairs:     'the staircase — every step tread and riser, the full flight',
  wall:       'the wall surface(s) — each visible wall covered FULLY, edge to edge and from the floor line up to the ceiling line, leaving no strip uncovered on the left, right, top or bottom',
  ceiling:    'the ceiling surface',
  countertop: 'the countertop / counter surface',
  table:      'the tabletop surface',
  facade:     'the building facade / exterior cladding, covered fully',
  column:     'the column(s) / pillar(s) — wrapping their full visible height and curvature',
}

export interface VisualizeInput {
  scene: { data: Buffer; mime: string }
  marble?: { data: Buffer; mime: string }
  // e.g. ["floor", "stairs"] — already localized to short English surface words.
  surfaces: string[]
  marbleName: string
  // 'surface' (default) retextures surfaces; 'place' inserts the product object.
  mode?: 'surface' | 'place'
  // Optional free-text hint for 'place' mode, e.g. "the empty vanity spot on the
  // right" — may be Arabic or English. When empty the AI auto-chooses the spot.
  placementHint?: string
  // Per-render provider/model/quality. Defaults: gemini + its default model.
  provider?: ImageProvider
  model?: string
  quality?: ImageQuality | 'auto'
}

function buildSurfacePrompt(input: VisualizeInput): string {
  const targets = input.surfaces.length
    ? input.surfaces.map(s => SURFACE_DESC[s] || s).join('; AND ')
    : 'the single main surface in the photo'
  const material = input.marbleName
    ? `${input.marbleName} (the stone shown in the SECOND image)`
    : 'the stone/marble shown in the SECOND image'

  // Deliberately strict: an in-place material swap, not a re-imagining.
  return [
    'TASK: A precise, localized MATERIAL-REPLACEMENT edit of a real photograph (the FIRST image). You are a professional architectural visualizer, not a designer — you do not redesign anything.',
    '',
    'ABSOLUTE RULE — PRESERVE EVERYTHING: Reproduce the FIRST image EXACTLY. Keep the identical composition, camera angle, framing, perspective, depth and proportions. Do NOT add, remove, move, resize, duplicate, recolour, restyle, "improve", or redesign ANYTHING — every wall, floor, object, furniture piece, appliance, plant, rug, fixture, window, door, person, toy and decoration stays pixel-for-pixel identical: same position, same shape, same colour. Keep the same lighting, shadows, reflections and white balance.',
    '',
    `THE ONLY CHANGE ALLOWED: replace the surface MATERIAL of ${targets} with ${material}. Absolutely nothing else in the image may change.`,
    '',
    'HOW TO APPLY THE MATERIAL — make it look real and professional:',
    input.marble
      ? '- The SECOND image is the EXACT material sample to use. Replicate it FAITHFULLY across the surface: the SAME stone colour, the SAME veining character and density, and — if it is a patterned tile or mosaic — the SAME tile shape, the SAME layout, the SAME joint/grout colour, and the SAME proportions. Do NOT invent a different pattern, do NOT recolour the stone, do NOT simplify or change the tile geometry. The finished surface must be instantly recognisable as the SAME product shown in the sample.'
      : `- Apply ${input.marbleName || 'the named stone'} faithfully — realistic colour, veining and finish.`,
    '- Cover the ENTIRE target surface completely — edge to edge, corner to corner — with NO gaps, NO untouched patches, and NO empty strips on any side. Follow the surface real geometry and perspective (vanishing lines) and wrap the stone continuously across its full visible extent.',
    '- Scale and tile the stone naturally with correct perspective, so slabs and veins recede with depth and seams stay realistic and aligned.',
    '- Carry over the scene existing lighting onto the new stone: same highlights, soft shadows, ambient occlusion and reflections, so it sits believably in the space.',
    '- OCCLUSION: anything in front of or resting on the target surface (rugs, furniture, objects, people, railings, steps above, skirting) MUST stay in front, unchanged, and correctly cover the new stone. Never paint stone over those items.',
    '- EDGES: stop the stone exactly at the surface boundary; do not bleed onto adjacent walls, ceilings, floors, trim or objects.',
    '',
    'OUTPUT: one photorealistic image, same aspect ratio and same content as the FIRST image, differing ONLY in the material of the requested surface(s).',
  ].join('\n')
}

function buildPlacePrompt(input: VisualizeInput): string {
  const product = input.marbleName ? `the product (${input.marbleName})` : 'the product'
  const where = input.placementHint && input.placementHint.trim()
    ? `Place it specifically at: ${input.placementHint.trim()}. If that exact spot is unclear, choose the closest sensible location matching that intent.`
    : 'Choose the single MOST suitable, natural and unobstructed location for it: look for the empty / intended spot it is designed for (e.g. an empty vanity counter or plumbing stub-out for a basin, an empty floor area for a table or column, an empty wall niche for a panel). If several spots work, pick the most prominent, well-composed one.'

  return [
    'TASK: Photorealistically INSERT a product into a real photograph (the FIRST image). The SECOND image shows the product to place. You are a professional product-staging / compositing artist.',
    '',
    'ABSOLUTE RULE — PRESERVE THE SCENE: Reproduce the FIRST image EXACTLY. Keep the identical composition, camera angle, framing, perspective, lighting, shadows and white balance. Do NOT move, remove, resize, recolour, restyle or redesign anything already in the scene, and do NOT change the walls, floor or finishes. The ONLY change is adding the product.',
    '',
    `ADD ${product} into the scene, taken from the SECOND image. ${where}`,
    '',
    'MAKE IT LOOK REAL AND PROFESSIONAL:',
    '- Keep the product own design, material, colour, veining and proportions from the SECOND image — integrate it into the room, do NOT restyle the room around it.',
    '- Scale it correctly relative to the surrounding objects (a basin sits at counter height, a table at human scale, etc.) — never oversized or floating.',
    '- Match the scene perspective and the SAME light direction and colour temperature; give it a realistic contact shadow and, on glossy floors/counters, a subtle correct reflection so it is physically grounded, not pasted.',
    '- Respect OCCLUSION: existing objects in front of the chosen spot stay in front of the product; the product sits behind them naturally.',
    '- Connect it believably to the environment (flush to the wall/counter/floor it rests on, plumbing/edges aligned where relevant). No empty halo, no cut-out edges.',
    '',
    'OUTPUT: one photorealistic image, same aspect ratio and same scene as the FIRST image, with the product naturally placed and everything else unchanged.',
  ].join('\n')
}

// Entry point — picks the prompt for the mode, then dispatches to the chosen
// provider. Both return a base64 PNG. Default provider is Gemini (cheapest).
export async function applyMarbleToScene(input: VisualizeInput): Promise<string> {
  const prompt = input.mode === 'place' ? buildPlacePrompt(input) : buildSurfacePrompt(input)
  return input.provider === 'openai'
    ? runOpenAI(input, prompt)
    : runGemini(input, prompt)
}

async function runOpenAI(input: VisualizeInput, prompt: string): Promise<string> {
  const apiKey = await getOpenAiKey()
  if (!apiKey) throw new Error('OpenAI API key not configured.')
  const client = new OpenAI({ apiKey })

  const model = input.model || OPENAI_DEFAULT_MODEL
  const quality = input.quality || 'high'

  const images = [await toFile(input.scene.data, 'scene.png', { type: input.scene.mime || 'image/png' })]
  if (input.marble) {
    images.push(await toFile(input.marble.data, 'marble.png', { type: input.marble.mime || 'image/png' }))
  }

  // input_fidelity:'high' is the key preservation lever, but only some models
  // accept it — gate it, then retry once without it if the model rejects it.
  const base = { model, image: images, prompt, size: 'auto' as const, quality }
  const wantFidelity = supportsInputFidelity(model)
  let res
  try {
    res = await client.images.edit(wantFidelity ? { ...base, input_fidelity: 'high' as const } : base)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (wantFidelity && /input_fidelity|does not support/i.test(msg)) {
      res = await client.images.edit(base)
    } else {
      throw e
    }
  }
  const b64 = res.data?.[0]?.b64_json
  if (!b64) throw new Error('No image returned from OpenAI.')
  return b64
}

async function runGemini(input: VisualizeInput, prompt: string): Promise<string> {
  const apiKey = await getGeminiKey()
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured.')
  const ai = new GoogleGenAI({ apiKey })
  const model = input.model || 'gemini-2.5-flash-image'

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: prompt },
    { text: 'FIRST image — the scene to edit:' },
    { inlineData: { mimeType: input.scene.mime || 'image/png', data: input.scene.data.toString('base64') } },
  ]
  if (input.marble) {
    parts.push({ text: 'SECOND image — the product / material sample:' })
    parts.push({ inlineData: { mimeType: input.marble.mime || 'image/png', data: input.marble.data.toString('base64') } })
  }

  const res = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE'] },
  })

  for (const part of res.candidates?.[0]?.content?.parts || []) {
    const data = part.inlineData?.data
    if (data) return data
  }
  throw new Error('No image returned from Gemini (check that paid Gemini billing/quota is active).')
}
