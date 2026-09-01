export const coreMaterialBrandPath = 'corematerialbrands'

export const coreMaterialBrandMethods = ['find', 'get', 'create', 'patch', 'remove']

export const coreMaterialBrandClient = (client) => {
  const connection = client.get('connection')

  client.use(coreMaterialBrandPath, connection.service(coreMaterialBrandPath), {
    methods: coreMaterialBrandMethods
  })
}
