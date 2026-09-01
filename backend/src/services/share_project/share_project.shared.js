export const shareProjectPath = 'shareproject'

export const shareProjectMethods = ['find', 'get', 'create', 'patch', 'remove']

export const shareProjectClient = (client) => {
  const connection = client.get('connection')

  client.use(shareProjectPath, connection.service(shareProjectPath), {
    methods: shareProjectMethods
  })
}
