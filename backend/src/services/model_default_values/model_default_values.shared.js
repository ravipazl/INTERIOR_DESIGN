export const modelDefaultValuesPath = 'modeldefaultvalues'

export const modelDefaultValuesMethods = ['find', 'get', 'create', 'patch', 'remove']

export const modelDefaultValuesClient = (client) => {
  const connection = client.get('connection')

  client.use(modelDefaultValuesPath, connection.service(modelDefaultValuesPath), {
    methods: modelDefaultValuesMethods
  })
}
