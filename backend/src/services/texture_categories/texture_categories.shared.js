export const textureCategoryPath = 'texturecategories'

export const textureCategoryMethods = ['find', 'get', 'create', 'patch', 'remove']

export const textureCategoryClient = (client) => {
  const connection = client.get('connection')

  client.use(textureCategoryPath, connection.service(textureCategoryPath), {
    methods: textureCategoryMethods
  })
}
