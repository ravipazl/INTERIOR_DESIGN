export const texturePath = 'textures'

export const textureMethods = ['find', 'get', 'create', 'patch', 'remove']

export const textureClient = (client) => {
  const connection = client.get('connection')

  client.use(texturePath, connection.service(texturePath), {
    methods: textureMethods
  })
}
