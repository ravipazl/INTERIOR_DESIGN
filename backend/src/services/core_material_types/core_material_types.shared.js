export const coreMaterialTypePath = 'corematerialtypes'

export const coreMaterialTypeMethods = ['find', 'get', 'create', 'patch', 'remove']

export const coreMaterialTypeClient = (client) => {
  const connection = client.get('connection')

  client.use(coreMaterialTypePath, connection.service(coreMaterialTypePath), {
    methods: coreMaterialTypeMethods
  })
}
