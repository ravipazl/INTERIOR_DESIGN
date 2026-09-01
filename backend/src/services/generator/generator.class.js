// This is a skeleton for a custom service class. Remove or add the methods you need here
import Replicate from 'replicate'
import { saveImageBuffer } from '../../imageUpload.js'

// Replicate runs in the cloud, so it CANNOT fetch an input image hosted on
// localhost (dev) or any private host. Instead of handing Replicate a URL, we
// download the image ourselves (the backend can reach its own localhost) and
// embed it as a base64 data-URI — Replicate then needs no network access to our
// host. This also works unchanged in production (no dependency on the image
// being publicly reachable). Falls back to the original ref on any failure.
async function inlineImageAsDataUri(imageRef) {
  if (!imageRef || typeof imageRef !== 'string') return imageRef
  if (imageRef.startsWith('data:')) return imageRef // already inlined
  try {
    const resp = await fetch(imageRef)
    if (!resp || !resp.ok) {
      console.error(
        `[generator] could not fetch input image (${resp && resp.status}); passing URL through`
      )
      return imageRef
    }
    const contentType = resp.headers.get('content-type') || 'image/jpeg'
    const arrayBuf = await resp.arrayBuffer()
    const b64 = Buffer.from(arrayBuf).toString('base64')
    return `data:${contentType};base64,${b64}`
  } catch (err) {
    console.error(
      '[generator] inlineImageAsDataUri failed, passing URL through:',
      err?.message || err
    )
    return imageRef
  }
}

export class AiGeneratorServiceService {
  constructor(options) {
    this.options = options || {}
  }
  setup(app) {
    this.app = app
  }

  async find(_params) {
    return []
  }

  async get(id, _params) {
    return {
      id: 0,
      text: `A new message with ID: ${id}!`
    }
  }

  async create(data, params) {
    if (params?.user?.permissions) {
      const inputImage = data.inputImage
      const inputImageId = data.inputImageId
      const roomType = data.roomType
      const themeName = data.themeName
      const roomName = data.roomName
      const userId = data.userId
      const projectId = data.projectId
      const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN
      })
      // Inline the photo so Replicate doesn't have to reach our (possibly
      // localhost / private) image host.
      const inputImageData = await inlineImageAsDataUri(inputImage)
      // Reliable line-detection interior model (jagilley/controlnet-hough).
      // The depth model (adirik/interior-design) was tried for better object
      // preservation, but it's 2+ years old and fails on Replicate's current
      // setup ("Unable to infer channel dimension format"), so we use the model
      // that reliably produces images — with the B+C tuning (indoor + keep the
      // layout + lower creativity) that already gave good, faithful results.
      //
      // Configurable via env: to try a different/depth model later, set
      // REPLICATE_MODEL in the AI backend .env to "owner/name:version".
      const REPLICATE_MODEL =
        process.env.REPLICATE_MODEL ||
        'jagilley/controlnet-hough:854e8727697a057c525cdb45ab037f64ecca770a1769cc52287c2e56472a247b'
      const output = await replicate.run(REPLICATE_MODEL, {
        input: {
          // (C) Keep it indoors + same layout so it doesn't drift to gardens.
          prompt: `${roomType}, ${themeName} style interior, indoor room, fully furnished, same walls windows floor and room layout as the input`,
          image: inputImageData,
          // (B) Lower guidance = follow the actual room more than the words.
          scale: 9,
          ddim_steps: 25,
          a_prompt:
            'best quality, hyper realistic, extremely detailed, high definition, realistic interior room, consistent with the input room layout, furniture',
          // (C) Push away from outdoor/landscape drift.
          n_prompt:
            'outdoor, garden, patio, balcony, terrace, sky, landscape, trees, plants outside, lowres, cropped, worst quality, low quality, unfurnished, unreal shapes, jazzy patterns, unfinished furniture, broken furniture, painting, sketch, art, patterns on wall',
        },
      })
      // The model may return a single image URL (string) OR an array of URLs,
      // so normalise both shapes to one URL.
      let outputImage = null
      if (Array.isArray(output)) {
        outputImage = output.length === 2 ? output[1] : output[0]
      } else if (typeof output === 'string') {
        outputImage = output
      } else if (output && typeof output === 'object') {
        outputImage = output.url || output.image || output.output || null
      }
      if (outputImage) {
        // Download the Replicate-hosted result image, then save it to our
        // own image storage (was: S3 presigned PUT; now: local filesystem
        // via imageUpload.saveImageBuffer).
        const response = await fetch(outputImage)
        if (response && response.ok) {
          const arrayBuf = await response.arrayBuffer()
          const buffer = Buffer.from(arrayBuf)
          // Use the tail of the Replicate URL as the original filename hint.
          const fileName = `ai-${themeName}-${`${outputImage}`.substring(`${outputImage}`.length - 10)}.png`
          const saved = await saveImageBuffer(buffer, fileName)
          if (saved?.key) {
            const res3 = await this.app.service('images').create({
              url: `${saved.key}`,
              imageType: 'generated',
              roomType: `${roomType}`,
              userId: `${userId}`,
              projectID: `${projectId}`,
              roomName: `${roomName}`,
              inputImageId: `${inputImageId}`,
              themeName: `${themeName}`
            })
            if (res3) {
              return res3
            }
          }
        }
      }
    }
    return { success: false }
  }

  // This method has to be added to the 'methods' option to make it available to clients
  async update(id, data, _params) {
    return {
      id: 0,
      ...data
    }
  }

  async patch(id, data, _params) {
    return {
      id: 0,
      text: `Fallback for ${id}`,
      ...data
    }
  }

  async remove(id, _params) {
    return {
      id: 0,
      text: 'removed'
    }
  }
}

export const getOptions = (app) => {
  return { app }
}
