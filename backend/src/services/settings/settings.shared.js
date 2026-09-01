export const settingPath = 'settings'

export const settingMethods = ['find', 'get', 'create', 'patch', 'remove']

export const settingClient = (client) => {
  const connection = client.get('connection')

  client.use(settingPath, connection.service(settingPath), {
    methods: settingMethods
  })
}
