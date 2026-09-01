export const componentPropertiesPath = 'componentproperties'

export const componentPropertiesMethods = ['find', 'get', 'create', 'patch', 'remove']

export const componentPropertiesClient = (client) => {
  const connection = client.get('connection')

  client.use(componentPropertiesPath, connection.service(componentPropertiesPath), {
    methods: componentPropertiesMethods
  })
}
