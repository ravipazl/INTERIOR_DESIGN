export const furnishedModelComponentPath = 'furnishedmodelcomponents'

export const furnishedModelComponentMethods = ['find', 'get', 'create', 'patch', 'remove']

export const furnishedModelComponentClient = (client) => {
  const connection = client.get('connection')

  client.use(furnishedModelComponentPath, connection.service(furnishedModelComponentPath), {
    methods: furnishedModelComponentMethods
  })
}
