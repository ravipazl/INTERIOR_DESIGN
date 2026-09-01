export const furnishedModelPath = 'furnishedmodels'

export const furnishedModelMethods = ['find', 'get', 'create', 'patch', 'remove']

export const furnishedModelClient = (client) => {
  const connection = client.get('connection')

  client.use(furnishedModelPath, connection.service(furnishedModelPath), {
    methods: furnishedModelMethods
  })
}
