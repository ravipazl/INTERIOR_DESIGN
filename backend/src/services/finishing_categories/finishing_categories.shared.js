export const finishingCategoryPath = 'finishingcategories'

export const finishingCategoryMethods = ['find', 'get', 'create', 'patch', 'remove']

export const finishingCategoryClient = (client) => {
  const connection = client.get('connection')

  client.use(finishingCategoryPath, connection.service(finishingCategoryPath), {
    methods: finishingCategoryMethods
  })
}
