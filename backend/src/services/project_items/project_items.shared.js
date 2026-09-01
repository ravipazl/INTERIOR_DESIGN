export const projectItemPath = 'projectitems'

export const projectItemMethods = ['find', 'get', 'create', 'patch', 'remove']

export const projectItemClient = (client) => {
  const connection = client.get('connection')

  client.use(projectItemPath, connection.service(projectItemPath), {
    methods: projectItemMethods
  })
}
