export const verifyPath = 'verify'

export const verifyMethods = ['find', 'get', 'create', 'patch', 'remove']

export const verifyClient = (client) => {
  const connection = client.get('connection')

  client.use(verifyPath, connection.service(verifyPath), {
    methods: verifyMethods
  })
}
