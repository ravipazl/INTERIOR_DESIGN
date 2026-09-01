export const projectPath = 'projects'

export const projectMethods = ['find', 'get', 'create', 'patch', 'remove']

export const projectClient = (client) => {
  const connection = client.get('connection')

  client.use(projectPath, connection.service(projectPath), {
    methods: projectMethods
  })
}
