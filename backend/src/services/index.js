import { categories } from './categories/categories.js'
import { coreMaterialBrand } from './core_material_brands/core_material_brands.js'
import { coreMaterialType } from './core_material_types/core_material_types.js'
import { finishing } from './finishings/finishings.js'
import { floorplan } from './floorplans/floorplans.js'
import { furnishedModelComponent } from './furnished_model_components/furnished_model_components.js'
import { furnishedModel } from './furnished_models/furnished_models.js'
import { modelComponent } from './model_components/model_components.js'
import { model } from './models/models.js'
import { project } from './projects/projects.js'
import { texture } from './textures/textures.js'
import { user } from './users/users.js'
import { sync } from './sync/sync.js'
import { componentProperties } from './component_properties/component_properties.js'
import { finishingBrand } from './finishing_brands/finishing_brands.js'
import { finishingCategory } from './finishing_categories/finishing_categories.js'
import { modelDefaultValues } from './model_default_values/model_default_values.js'
import { textureCategory } from './texture_categories/texture_categories.js'
import { coreMaterialPricing } from './core_material_pricing/core_material_pricing.js'
import { finishingPricing } from './finishing_pricing/finishing_pricing.js'
import { generateBoq } from './generate_boq/generate_boq.js'
import { shareProject } from './share_project/share_project.js'
import { modelUpload } from './model-upload/model-upload.js'
import { imageTo3d } from './image-to-3d/image-to-3d.js'
import { sketchfab } from './sketchfab/sketchfab.js'
import { polyHaven } from './poly-haven/poly-haven.js'
import { objaverse } from './objaverse/objaverse.js'
import { catalogModelDelete } from './catalog-model-delete/catalog-model-delete.js'
import { render } from './render/render.js'
import { video } from './video/video.js'
import { floorplanAi } from './floorplan-ai/floorplan-ai.js'
import { floorplanTemplates } from './floorplan-templates/floorplan-templates.js'
import { thumbnailUpload } from './thumbnail-upload/thumbnail-upload.js'
import { hardware } from './hardware/hardware.js'
import { setting } from './settings/settings.js'
import { projectItem } from './project_items/project_items.js'
import { projectFileUpload } from './project-file-upload/project-file-upload.js'
import { sendQuote } from './send-quote/send-quote.js'
import { submitForApproval } from './submit-for-approval/submit-for-approval.js'
import { sendTrackerMail } from './send-tracker-mail/send-tracker-mail.js'
import { publicQuote } from './public-quote/public-quote.js'
import { whatsappTest } from './whatsapp-test/whatsapp-test.js'
// Folded in from the former standalone auth backend (auth is now in-process).
import { verify } from './verify/verify.js'
import { invite } from './invite/invite.js'
// Folded in from the former standalone AI backend.
import { aiGeneratorService } from './generator/generator.js'
import { image } from './images/images.js'
import { upload } from './upload/upload.js'

export const services = (app) => {
  // All services will be registered here
  app.configure(categories)
  app.configure(coreMaterialBrand)
  app.configure(coreMaterialType)
  app.configure(finishing)
  app.configure(floorplan)
  app.configure(furnishedModelComponent)
  app.configure(furnishedModel)
  app.configure(modelComponent)
  app.configure(model)
  app.configure(project)
  app.configure(texture)
  app.configure(user)
  app.configure(sync)
  app.configure(componentProperties)
  app.configure(finishingBrand)
  app.configure(finishingCategory)
  app.configure(modelDefaultValues)
  app.configure(textureCategory)
  app.configure(coreMaterialPricing)
  app.configure(finishingPricing)
  app.configure(generateBoq)
  app.configure(shareProject)
  app.configure(modelUpload)
  app.configure(imageTo3d)
  app.configure(sketchfab)
  app.configure(polyHaven)
  app.configure(objaverse)
  app.configure(catalogModelDelete)
  app.configure(render)
  app.configure(video)
  app.configure(floorplanAi)
  app.configure(floorplanTemplates)
  app.configure(thumbnailUpload)
  app.configure(hardware)
  app.configure(setting)
  app.configure(projectItem)
  app.configure(projectFileUpload)
  app.configure(sendQuote)
  app.configure(submitForApproval)
  app.configure(sendTrackerMail)
  app.configure(publicQuote)
  app.configure(whatsappTest)
  app.configure(verify)
  app.configure(invite)
  app.configure(aiGeneratorService)
  app.configure(image)
  app.configure(upload)
}
