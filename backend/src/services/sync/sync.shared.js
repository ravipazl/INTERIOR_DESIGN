export const syncServicePath = 'sync'

export const syncServiceMethods = ['find', 'get', 'create', 'patch', 'remove']

export const syncServiceClient = (client) => {
  const connection = client.get('connection')

  client.use(syncServicePath, connection.service(syncServicePath), {
    methods: syncServiceMethods
  })
}
