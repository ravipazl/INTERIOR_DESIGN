export const invitePath = 'invite'
export const inviteMethods = ['create', 'patch']

export const inviteClient = (client) => {
  const connection = client.get('connection')

  client.use(invitePath, connection.service(invitePath), {
    methods: inviteMethods
  })
}
