export const modelComponentPath = 'modelcomponents'

export const modelComponentMethods = ['find', 'get', 'create', 'patch', 'remove']

export const modelComponentClient = (client) => {
  const connection = client.get('connection')

  client.use(modelComponentPath, connection.service(modelComponentPath), {
    methods: modelComponentMethods
  })
}
