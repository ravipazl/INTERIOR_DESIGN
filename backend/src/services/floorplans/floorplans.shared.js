export const floorplanPath = 'floorplans'

export const floorplanMethods = ['find', 'get', 'create', 'patch', 'remove']

export const floorPlanClient = (client) => {
  const connection = client.get('connection')

  client.use(floorplanPath, connection.service(floorplanPath), {
    methods: floorplanMethods
  })
}
