import { v4 as uuidv4 } from 'uuid'
import { app } from './app.js'

const getMissingExteriorTextures = async (textures, finishings) => {
  let list = []
  await Promise.all(
    textures.map((texture) => {
      const found = finishings.some(
        (finishing) => finishing.textureId === texture._id && finishing.type === 'exterior'
      )
      if (!found) list.push(texture)
    })
  )
  return list
}

const getMissingWallTextures = async (textures, finishings) => {
  let list = []
  await Promise.all(
    textures.map((texture) => {
      const found = finishings.some(
        (finishing) => finishing.textureId === texture._id && finishing.type === 'wall'
      )
      if (!found) list.push(texture)
    })
  )
  return list
}

const getMissingFloorTextures = async (textures, finishings) => {
  let list = []
  await Promise.all(
    textures.map((texture) => {
      const found = finishings.some(
        (finishing) => finishing.textureId === texture._id && finishing.type === 'floor'
      )
      if (!found) list.push(texture)
    })
  )
  return list
}

const createExteriorFinishings = async (textures, finishingCategories) => {
  await Promise.all(
    textures.map(async (texture, index) => {
      let url = `${texture.fileUrl}`.replace(
        '/assets/rooms/textures/library/',
        ''
      )
      url = url.substring(0, url.indexOf('/'))
      const finishingCategoryId = finishingCategories.find(
        (category) => category.name.toLowerCase() === url?.toLowerCase()
      )?._id
      await app.service('finishings').create({
        _id: uuidv4(),
        name: texture.name,
        type: 'exterior',
        categoryId: finishingCategoryId ?? null,
        brands: ['GreenPly Plywoods', "Brownmans's Plywoods"],
        textureId: texture._id,
        grain_direction: index % 2 === 0 ? 'vertical' : 'horizontal',
        finish_texture: ['matte', 'laminated']
      })
    })
  )
  return true
}

const createWallFinishings = async (textures, finishingCategories) => {
  await Promise.all(
    textures.map(async (texture, index) => {
      let url = `${texture.fileUrl}`.replace(
        '/assets/rooms/textures/library/',
        ''
      )
      url = url.substring(0, url.indexOf('/'))
      const finishingCategoryId = finishingCategories.find(
        (category) => category.name.toLowerCase() === url?.toLowerCase()
      )?._id
      await app.service('finishings').create({
        _id: uuidv4(),
        name: texture.name,
        type: 'wall',
        categoryId: finishingCategoryId ?? null,
        brands: ['GreenPly Plywoods', "Brownmans's Plywoods"],
        textureId: texture._id,
        grain_direction: index % 2 === 0 ? 'vertical' : 'horizontal',
        finish_texture: ['matte', 'laminated']
      })
    })
  )
  return true
}

const createFloorFinishings = async (textures, finishingCategories) => {
  await Promise.all(
    textures.map(async (texture, index) => {
      let url = `${texture.fileUrl}`.replace(
        '/assets/rooms/textures/library/',
        ''
      )
      url = url.substring(0, url.indexOf('/'))
      const finishingCategoryId = finishingCategories.find(
        (category) => category.name.toLowerCase() === url?.toLowerCase()
      )?._id
      await app.service('finishings').create({
        _id: uuidv4(),
        name: texture.name,
        type: 'floor',
        categoryId: finishingCategoryId ?? null,
        brands: ['GreenPly Plywoods', "Brownmans's Plywoods"],
        textureId: texture._id,
        grain_direction: index % 2 === 0 ? 'vertical' : 'horizontal',
        finish_texture: ['matte', 'laminated']
      })
    })
  )
  return true
}

const createFinishingsForTextures = async () => {
  let finishingCategories = await app.service('finishingcategories').find({})
  finishingCategories = finishingCategories?.data
  let finishings = await app.service('finishings').find({})
  finishings = finishings?.data
  console.log('Total finishings:', finishings?.length)
  let textures = await app.service('textures').find({})
  textures = textures?.data
  console.log('Total textures:', textures?.length)
  let texturesWithoutExteriorFinishings = await getMissingExteriorTextures(textures, finishings)
  console.log('Total textures without exterior finishings:', texturesWithoutExteriorFinishings?.length)
  await createExteriorFinishings(texturesWithoutExteriorFinishings, finishingCategories)
  let texturesWithoutWallFinishings = await getMissingWallTextures(textures, finishings)
  console.log('Total textures without wall finishings:', texturesWithoutWallFinishings?.length)
  await createWallFinishings(texturesWithoutWallFinishings, finishingCategories)
  let texturesWithoutFloorFinishings = await getMissingFloorTextures(textures, finishings)
  console.log('Total textures without floor finishings:', texturesWithoutFloorFinishings?.length)
  await createFloorFinishings(texturesWithoutFloorFinishings, finishingCategories)
  return true
}

// createFinishingsForTextures()
