import { v4 as uuidv4 } from 'uuid'
import { app } from './app.js'

const texturesList = [
  {
    _id: 'f52f9b8f-b14c-4b1d-a049-dd2a5525e361',
    name: '15105',
    fileUrl: '/assets/rooms/textures/library/contemporary/15105.jpg'
  },
  {
    _id: '2d89a06c-9f8c-4f26-8c06-8735c443374c',
    name: '15107',
    fileUrl: '/assets/rooms/textures/library/contemporary/15107.jpg'
  },
  {
    _id: '18973d57-7a4c-48f5-850e-3912b04578c9',
    name: '15111',
    fileUrl: '/assets/rooms/textures/library/contemporary/15111.jpg'
  },
  {
    _id: '47cd0bfd-940b-4002-9432-be654cb7ffb1',
    name: '15112',
    fileUrl: '/assets/rooms/textures/library/contemporary/15112.jpg'
  },
  {
    _id: '28c5833c-b93a-4389-a309-09df59fc4f19',
    name: '15113',
    fileUrl: '/assets/rooms/textures/library/contemporary/15113.jpg'
  },
  {
    _id: '53a98c96-6ef4-4a53-bae3-e3944df3382f',
    name: '15114',
    fileUrl: '/assets/rooms/textures/library/contemporary/15114.jpg'
  },
  {
    _id: 'd20febd2-7c3d-4ea9-bdc4-b008af00f5e7',
    name: '15115',
    fileUrl: '/assets/rooms/textures/library/contemporary/15115.jpg'
  },
  {
    _id: '517c3887-69f9-4c9e-962b-b95e85a474db',
    name: '15116',
    fileUrl: '/assets/rooms/textures/library/contemporary/15116.jpg'
  },
  {
    _id: '558a3e4e-9ee7-4500-9ef9-59d3d11539f6',
    name: '15117',
    fileUrl: '/assets/rooms/textures/library/contemporary/15117.jpg'
  },
  {
    _id: '562e71ec-047d-4c79-a73a-656e478e8d66',
    name: '15118',
    fileUrl: '/assets/rooms/textures/library/contemporary/15118.jpg'
  },
  {
    _id: 'a996ca71-d162-4fbb-a405-5624932be4c6',
    name: '15119',
    fileUrl: '/assets/rooms/textures/library/contemporary/15119.jpg'
  },
  {
    _id: 'c3b38f39-2d2f-44d9-adca-6254a979f76b',
    name: '15120',
    fileUrl: '/assets/rooms/textures/library/contemporary/15120.jpg'
  },
  {
    _id: '7e3d50ca-a326-4835-ba12-bbe0066067ea',
    name: '15122',
    fileUrl: '/assets/rooms/textures/library/contemporary/15122.jpg'
  },
  {
    _id: 'f4f4bc08-64b4-4385-b501-58f16724807c',
    name: '15123',
    fileUrl: '/assets/rooms/textures/library/contemporary/15123.jpg'
  },
  {
    _id: '59401995-292b-4815-8d5c-21ed9061a985',
    name: '15125',
    fileUrl: '/assets/rooms/textures/library/contemporary/15125.jpg'
  },
  {
    _id: '21a8897d-d144-4c69-9cb3-17845e7db96b',
    name: '15126',
    fileUrl: '/assets/rooms/textures/library/contemporary/15126.jpg'
  },
  {
    _id: '50c6bb7b-906c-4ad8-b635-365fcbcf98d3',
    name: '15128',
    fileUrl: '/assets/rooms/textures/library/contemporary/15128.jpg'
  },
  {
    _id: 'e5f3aa4f-8c23-4304-ac94-f2f12ea68a83',
    name: '15129',
    fileUrl: '/assets/rooms/textures/library/contemporary/15129.jpg'
  },
  {
    _id: '470b4cc1-5674-4b55-8847-54244e0b9c5c',
    name: '15130',
    fileUrl: '/assets/rooms/textures/library/contemporary/15130.jpg'
  },
  {
    _id: 'fd6d1559-c2b8-4658-b256-c5e1e9a887ed',
    name: '15131',
    fileUrl: '/assets/rooms/textures/library/contemporary/15131.jpg'
  },
  {
    _id: 'c7e787b1-dafb-400c-b1b3-ec10724140ed',
    name: '15132',
    fileUrl: '/assets/rooms/textures/library/contemporary/15132.jpg'
  },
  {
    _id: 'b4ae675a-5f59-4f0d-b41f-c0c5889be113',
    name: '15134',
    fileUrl: '/assets/rooms/textures/library/contemporary/15134.jpg'
  },
  {
    _id: '3f890b6f-a771-47c4-aa14-1c909332952d',
    name: '40265',
    fileUrl: '/assets/rooms/textures/library/contemporary/40265.jpg'
  },
  {
    _id: 'bf165283-8f7a-4d3c-ba62-a9f3d7831be7',
    name: '40266',
    fileUrl: '/assets/rooms/textures/library/contemporary/40266.jpg'
  },
  {
    _id: '98eae901-e42d-4100-9dba-95988d37b950',
    name: '40267',
    fileUrl: '/assets/rooms/textures/library/contemporary/40267.jpg'
  },
  {
    _id: '1bdacc1b-ae31-4fde-a12f-c1b192c584ac',
    name: '41001',
    fileUrl: '/assets/rooms/textures/library/contemporary/41001.jpg'
  },
  {
    _id: 'a27b2fc1-ca48-42ee-8bda-3293ce56a76c',
    name: '41002',
    fileUrl: '/assets/rooms/textures/library/contemporary/41002.jpg'
  },
  {
    _id: '61b451a4-c33e-4ee7-b87c-d2d01bf40b9a',
    name: '41003',
    fileUrl: '/assets/rooms/textures/library/contemporary/41003.jpg'
  },
  {
    _id: '1e955154-851f-413f-b676-b48803ed878b',
    name: '41004',
    fileUrl: '/assets/rooms/textures/library/contemporary/41004.jpg'
  },
  {
    _id: 'e528c68a-1e8d-4697-8949-728ac65eeccd',
    name: '44260',
    fileUrl: '/assets/rooms/textures/library/patterns/44260.jpg'
  },
  {
    _id: '372ee852-5925-4a27-82ad-2c2e9d710137',
    name: '44503',
    fileUrl: '/assets/rooms/textures/library/patterns/44503.jpg'
  },
  {
    _id: 'b8abff85-5605-47c4-a7d9-a3dc026c82fb',
    name: '44504',
    fileUrl: '/assets/rooms/textures/library/patterns/44504.jpg'
  },
  {
    _id: '5a61268f-3970-4f50-abba-8806fba8438e',
    name: '44505',
    fileUrl: '/assets/rooms/textures/library/patterns/44505.jpg'
  },
  {
    _id: '1ad4cc10-4dfa-4756-9ac4-45172cae0d55',
    name: '44506',
    fileUrl: '/assets/rooms/textures/library/patterns/44506.jpg'
  },
  {
    _id: 'cf0365d2-d18c-4a9a-a589-15d013c48c12',
    name: '44704',
    fileUrl: '/assets/rooms/textures/library/patterns/44704.jpg'
  },
  {
    _id: '502c2608-574b-4207-8cd8-bf3cf68d7408',
    name: '44708',
    fileUrl: '/assets/rooms/textures/library/patterns/44708.jpg'
  },
  {
    _id: '6c4910ad-53eb-47d1-8b18-5e8a59dd61bb',
    name: '44722',
    fileUrl: '/assets/rooms/textures/library/patterns/44722.jpg'
  },
  {
    _id: 'ef487848-3ebf-4fda-bbb0-25a6308000bc',
    name: '44723',
    fileUrl: '/assets/rooms/textures/library/patterns/44723.jpg'
  },
  {
    _id: 'f86f8308-d96a-495d-a626-aa7f2dee1cb0',
    name: '44752',
    fileUrl: '/assets/rooms/textures/library/patterns/44752.jpg'
  },
  {
    _id: '604f1872-3940-43dd-92b2-fa419072de1b',
    name: '44757',
    fileUrl: '/assets/rooms/textures/library/patterns/44757.jpg'
  },
  {
    _id: 'f5447fff-663b-48f4-a0c0-b052ca7920c8',
    name: '44758',
    fileUrl: '/assets/rooms/textures/library/patterns/44758.jpg'
  },
  {
    _id: 'c06f2cf9-a01f-4c41-88ff-15d85a7eed0a',
    name: '44759',
    fileUrl: '/assets/rooms/textures/library/patterns/44759.jpg'
  },
  {
    _id: '4989a11e-930e-4f1f-aa81-1dc4c1a9f9bc',
    name: '44773',
    fileUrl: '/assets/rooms/textures/library/patterns/44773.jpg'
  },
  {
    _id: '68e29674-ad6c-45b6-aecb-3483de3a13e2',
    name: '44775',
    fileUrl: '/assets/rooms/textures/library/patterns/44775.jpg'
  },
  {
    _id: 'd64c7988-c336-49a0-912d-cb6305f80917',
    name: '44776',
    fileUrl: '/assets/rooms/textures/library/patterns/44776.jpg'
  },
  {
    _id: '27d4d1de-484d-4a05-a5e6-a7ca14ed71f7',
    name: '44783',
    fileUrl: '/assets/rooms/textures/library/patterns/44783.jpg'
  },
  {
    _id: '38726a01-5c45-42a3-9f05-bc90dc75e6d7',
    name: '44784',
    fileUrl: '/assets/rooms/textures/library/patterns/44784.jpg'
  },
  {
    _id: 'd1c12abe-48d8-4ed2-aa13-e51e21bbb439',
    name: '44789',
    fileUrl: '/assets/rooms/textures/library/patterns/44789.jpg'
  },
  {
    _id: '00776586-8fb6-4e98-a2a9-ff77228e666b',
    name: '44790',
    fileUrl: '/assets/rooms/textures/library/patterns/44790.jpg'
  },
  {
    _id: 'ca43736d-b301-462d-a211-36235f005e61',
    name: '44791',
    fileUrl: '/assets/rooms/textures/library/patterns/44791.jpg'
  },
  {
    _id: 'cb2760eb-23be-4255-8f1f-c694c075da4a',
    name: '44796',
    fileUrl: '/assets/rooms/textures/library/patterns/44796.jpg'
  },
  {
    _id: '2655bdcc-6184-4a6e-ae97-180c385220fa',
    name: '49790',
    fileUrl: '/assets/rooms/textures/library/patterns/49790.jpg'
  },
  {
    _id: '82383276-f09c-4118-88c2-381fae2e7849',
    name: '49907',
    fileUrl: '/assets/rooms/textures/library/patterns/49907.jpg'
  },
  {
    _id: 'cda52698-e36c-4c67-a118-c87531ef5b04',
    name: '49908',
    fileUrl: '/assets/rooms/textures/library/patterns/49908.jpg'
  },
  {
    _id: 'f6d63752-2891-4200-bf80-2ff0786bb95c',
    name: '49909',
    fileUrl: '/assets/rooms/textures/library/patterns/49909.jpg'
  },
  {
    _id: '5cd176fe-16a5-470e-ac31-3e130e7c7395',
    name: '49918',
    fileUrl: '/assets/rooms/textures/library/patterns/49918.jpg'
  },
  {
    _id: '41fd1653-4a68-4022-b7d4-7b6ff1ea4283',
    name: '49922',
    fileUrl: '/assets/rooms/textures/library/patterns/49922.jpg'
  },
  {
    _id: '0bf1d890-9108-4605-a77b-41f48389bc0e',
    name: '49929',
    fileUrl: '/assets/rooms/textures/library/patterns/49929.jpg'
  },
  {
    _id: '6de657be-0a25-4a95-98ec-e02b7f04935f',
    name: '49931',
    fileUrl: '/assets/rooms/textures/library/patterns/49931.jpg'
  },
  {
    _id: 'a3d88c7a-4c75-4e55-a395-dfeed738df2c',
    name: '49944',
    fileUrl: '/assets/rooms/textures/library/patterns/49944.jpg'
  },
  {
    _id: 'a200e608-036b-43db-9a00-ed2e884a65a9',
    name: '49947',
    fileUrl: '/assets/rooms/textures/library/patterns/49947.jpg'
  },
  {
    _id: '9f41bb0f-a8b7-4831-b563-e3620e8033fc',
    name: '49948',
    fileUrl: '/assets/rooms/textures/library/patterns/49948.jpg'
  },
  {
    _id: '21bb8e87-ac1d-4b3f-8c25-01b6da04063e',
    name: '49949',
    fileUrl: '/assets/rooms/textures/library/patterns/49949.jpg'
  },
  {
    _id: 'ccd94977-09fe-4cc6-b66d-739c4e5a65d8',
    name: '49952-1',
    fileUrl: '/assets/rooms/textures/library/patterns/49952-1.jpg'
  },
  {
    _id: '7b88402d-ff0c-48f1-b140-18535df91c40',
    name: '49953',
    fileUrl: '/assets/rooms/textures/library/patterns/49953.jpg'
  },
  {
    _id: 'dd39df16-067c-4694-a308-7a3114a981bc',
    name: '49959',
    fileUrl: '/assets/rooms/textures/library/patterns/49959.jpg'
  },
  {
    _id: 'a239c123-90fd-4e2d-9ed4-765a9643dbc1',
    name: '49960',
    fileUrl: '/assets/rooms/textures/library/patterns/49960.jpg'
  },
  {
    _id: '544a3a4b-b8de-48f1-80bf-24909143fbe9',
    name: '49961',
    fileUrl: '/assets/rooms/textures/library/patterns/49961.jpg'
  },
  {
    _id: '8a02abe6-a396-4a48-8729-8f99e17ff334',
    name: '49962',
    fileUrl: '/assets/rooms/textures/library/patterns/49962.jpg'
  },
  {
    _id: '446137eb-73b8-4172-9747-eb9a0712dc97',
    name: '21003',
    fileUrl: '/assets/rooms/textures/library/solids/21003.jpg'
  },
  {
    _id: '5055fa3f-ba46-49a0-a38c-fd1030a472b8',
    name: '21004',
    fileUrl: '/assets/rooms/textures/library/solids/21004.jpg'
  },
  {
    _id: '2bd62bb3-2e5b-4dc3-a816-d4cdd6930e05',
    name: '21007',
    fileUrl: '/assets/rooms/textures/library/solids/21007.jpg'
  },
  {
    _id: '98cec036-7069-4dd5-bca5-8c5e087d0296',
    name: '21012',
    fileUrl: '/assets/rooms/textures/library/solids/21012.jpg'
  },
  {
    _id: '54abf09d-bf89-4404-8a12-3dd2a9dfdfc7',
    name: '21013',
    fileUrl: '/assets/rooms/textures/library/solids/21013.jpg'
  },
  {
    _id: 'ee7a38ff-7397-4fa3-b4fa-d2333e50607b',
    name: '40001',
    fileUrl: '/assets/rooms/textures/library/stone/40001.jpg'
  },
  {
    _id: '6680a1dd-f41b-4495-834c-3109bb60befc',
    name: '40002',
    fileUrl: '/assets/rooms/textures/library/stone/40002.jpg'
  },
  {
    _id: '420e27f5-cd5e-42f0-bcf5-37e9c7ced46e',
    name: '40003',
    fileUrl: '/assets/rooms/textures/library/stone/40003.jpg'
  },
  {
    _id: '693f4669-2819-4d37-9ff2-3606b1556270',
    name: '40004',
    fileUrl: '/assets/rooms/textures/library/stone/40004.jpg'
  },
  {
    _id: '2ba0583f-a901-452b-a796-3a46634f1230',
    name: '40013',
    fileUrl: '/assets/rooms/textures/library/stone/40013.jpg'
  },
  {
    _id: '70c657a8-3595-4d79-a63d-33905939d504',
    name: 'Good Earth - Bagh E Noor',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Bagh%20E%20Noor.jpeg'
  },
  {
    _id: '54fcf61c-5bc2-47eb-825d-d7e80bc0c553',
    name: 'Good Earth - Dune Coral',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Dune%20Coral.jpeg'
  },
  {
    _id: 'fb4d81b9-6ad5-4099-811e-be97de86b842',
    name: 'Good Earth - Dune Verdigris',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Dune%20Verdigris.jpeg'
  },
  {
    _id: '943398f6-3967-4eec-9ea4-7d1ad6e285b5',
    name: 'Good Earth - Isfahan',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Isfahan.jpeg'
  },
  {
    _id: '74d12779-9fd6-4be4-a09d-1ba6df600931',
    name: 'Good Earth - Palm Grove Ivory',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Palm%20Grove%20Ivory.jpeg'
  },
  {
    _id: 'fb7974b9-d606-4d9b-8de3-e09d77c5b640',
    name: '10002',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10002.jpg'
  },
  {
    _id: '03ef5647-8c2b-4409-bad3-6f41914ee8fa',
    name: '10007',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10007.jpg'
  },
  {
    _id: 'afe5ff38-c438-4e9a-b90b-24f13677e623',
    name: '10009',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10009.jpg'
  },
  {
    _id: 'bda30e4f-045b-4846-ae26-45bd03ff2170',
    name: '10012',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10012.jpg'
  },
  {
    _id: '87d0d8d0-c21a-4148-b1a0-a3fe2a8daff7',
    name: '10013',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10013.jpg'
  },
  {
    _id: 'be264379-d78a-4674-b8d4-92da10b28d39',
    name: '21014',
    fileUrl: '/assets/rooms/textures/library/solids/21014.jpg'
  },
  {
    _id: '7293c15f-b160-47b3-9bf4-5dae1ee2d4ce',
    name: '21023',
    fileUrl: '/assets/rooms/textures/library/solids/21023.jpg'
  },
  {
    _id: 'dc3b35d6-61fa-437e-887d-221bb5682f78',
    name: '21024',
    fileUrl: '/assets/rooms/textures/library/solids/21024.jpg'
  },
  {
    _id: '21200955-0b0c-48ee-b9e7-422274b87541',
    name: '21027',
    fileUrl: '/assets/rooms/textures/library/solids/21027.jpg'
  },
  {
    _id: '0b2a7bca-b7c0-4bf9-a14c-db923313edf4',
    name: '21028',
    fileUrl: '/assets/rooms/textures/library/solids/21028.jpg'
  },
  {
    _id: 'ab5885b1-fc6f-4051-860a-a674252a4fbd',
    name: '21032',
    fileUrl: '/assets/rooms/textures/library/solids/21032.jpg'
  },
  {
    _id: '823c6417-5a8b-4a68-980e-59dc005a3ba2',
    name: '21037',
    fileUrl: '/assets/rooms/textures/library/solids/21037.jpg'
  },
  {
    _id: '5f75b9cc-55a1-4e4a-a84c-7ce18905820b',
    name: '21038',
    fileUrl: '/assets/rooms/textures/library/solids/21038.jpg'
  },
  {
    _id: '185fff36-fd81-437e-aa44-0db28ffcd1c0',
    name: '21042',
    fileUrl: '/assets/rooms/textures/library/solids/21042.jpg'
  },
  {
    _id: 'a3726bbf-176a-4651-bd55-81c8370c7c24',
    name: '21051',
    fileUrl: '/assets/rooms/textures/library/solids/21051.jpg'
  },
  {
    _id: 'dd081757-945e-4e43-af52-4013c2eadfda',
    name: '21054',
    fileUrl: '/assets/rooms/textures/library/solids/21054.jpg'
  },
  {
    _id: '7842f310-81dc-45cb-ab14-9fb7fa74c936',
    name: '21055',
    fileUrl: '/assets/rooms/textures/library/solids/21055.jpg'
  },
  {
    _id: '4114d261-c089-42ae-a7c0-2cdc8ee8c2d5',
    name: '21057',
    fileUrl: '/assets/rooms/textures/library/solids/21057.jpg'
  },
  {
    _id: '91752f9f-0273-4d12-af77-a839fff1fb80',
    name: '21061',
    fileUrl: '/assets/rooms/textures/library/solids/21061.jpg'
  },
  {
    _id: 'f4949ef1-3db0-4c34-b05f-dcbadd4efcc9',
    name: '21063',
    fileUrl: '/assets/rooms/textures/library/solids/21063.jpg'
  },
  {
    _id: '3c7f16f2-b57b-4b1b-b54f-a5a3d8fac3bb',
    name: '21065',
    fileUrl: '/assets/rooms/textures/library/solids/21065.jpg'
  },
  {
    _id: '502c63f4-bdf3-4cda-aeae-d0081569be4d',
    name: '21066',
    fileUrl: '/assets/rooms/textures/library/solids/21066.jpg'
  },
  {
    _id: 'ccb3bedc-21b5-4ecf-9f96-858db5b000b1',
    name: '21067',
    fileUrl: '/assets/rooms/textures/library/solids/21067.jpg'
  },
  {
    _id: '61c29461-2ee0-4b0f-a76f-a363f48ef75b',
    name: '21069',
    fileUrl: '/assets/rooms/textures/library/solids/21069.jpg'
  },
  {
    _id: '8d81d204-6868-4454-a5ce-f4927eec6ee2',
    name: '21074',
    fileUrl: '/assets/rooms/textures/library/solids/21074.jpg'
  },
  {
    _id: '95c9b7cc-5fe0-4306-99d2-bdca47cd8b55',
    name: '21075',
    fileUrl: '/assets/rooms/textures/library/solids/21075.jpg'
  },
  {
    _id: '6532ec08-fa10-48c3-8572-2190b113bafb',
    name: '21077',
    fileUrl: '/assets/rooms/textures/library/solids/21077.jpg'
  },
  {
    _id: '02f60fdf-1266-40be-968b-92c7d806b7bc',
    name: '21082',
    fileUrl: '/assets/rooms/textures/library/solids/21082.jpg'
  },
  {
    _id: '305c7610-0fa0-486b-a077-0e5df4859178',
    name: '21087',
    fileUrl: '/assets/rooms/textures/library/solids/21087.jpg'
  },
  {
    _id: '3bdb89dd-20b2-42af-b783-6143c008317a',
    name: '21089',
    fileUrl: '/assets/rooms/textures/library/solids/21089.jpg'
  },
  {
    _id: '65d91c83-dc55-4ad0-bde7-9714b093fe65',
    name: '21091',
    fileUrl: '/assets/rooms/textures/library/solids/21091.jpg'
  },
  {
    _id: '7cdc2955-fa40-4b83-bf9c-7e05bf69a71a',
    name: '21092',
    fileUrl: '/assets/rooms/textures/library/solids/21092.jpg'
  },
  {
    _id: 'f5bbe9d0-9bae-41b1-8163-79275de40587',
    name: '21097',
    fileUrl: '/assets/rooms/textures/library/solids/21097.jpg'
  },
  {
    _id: 'aad0e153-32a9-4a6e-a679-a6de2cfb7551',
    name: '21099',
    fileUrl: '/assets/rooms/textures/library/solids/21099.jpg'
  },
  {
    _id: '78ca843a-e4d4-4e38-b9ac-ee1f9aee089f',
    name: '21103',
    fileUrl: '/assets/rooms/textures/library/solids/21103.jpg'
  },
  {
    _id: 'a97d990a-f760-4ce4-b950-025de63bd2ad',
    name: '21109',
    fileUrl: '/assets/rooms/textures/library/solids/21109.jpg'
  },
  {
    _id: '9dbc5749-e4f1-419b-ab78-f2d6c710cd2b',
    name: '21114',
    fileUrl: '/assets/rooms/textures/library/solids/21114.jpg'
  },
  {
    _id: '4f4a7698-1ff1-4e5d-8076-f74ccde6ffd1',
    name: '21122',
    fileUrl: '/assets/rooms/textures/library/solids/21122.jpg'
  },
  {
    _id: '9664eb5a-4267-471d-ad95-0ea0a134dbe3',
    name: '21127',
    fileUrl: '/assets/rooms/textures/library/solids/21127.jpg'
  },
  {
    _id: '53453cf6-2688-439b-9968-7fe5d446b9f8',
    name: '21132',
    fileUrl: '/assets/rooms/textures/library/solids/21132.jpg'
  },
  {
    _id: '5874337b-57d1-46fc-848f-fb7a1b460bf8',
    name: '21142',
    fileUrl: '/assets/rooms/textures/library/solids/21142.jpg'
  },
  {
    _id: 'e6eb1791-9dcd-4715-b759-b76f089a29fd',
    name: '21143',
    fileUrl: '/assets/rooms/textures/library/solids/21143.jpg'
  },
  {
    _id: '2e77fd5d-bcb6-4205-aa7f-21b9aa126562',
    name: '21155',
    fileUrl: '/assets/rooms/textures/library/solids/21155.jpg'
  },
  {
    _id: '8dabafda-fc7d-427a-a537-7c70d4b10edb',
    name: '21161',
    fileUrl: '/assets/rooms/textures/library/solids/21161.jpg'
  },
  {
    _id: '3b4cdcf4-067a-48a1-a894-67bd543d2fe5',
    name: '21162',
    fileUrl: '/assets/rooms/textures/library/solids/21162.jpg'
  },
  {
    _id: '94295e8f-9238-4093-a2b2-c4bcd9679bec',
    name: '21163',
    fileUrl: '/assets/rooms/textures/library/solids/21163.jpg'
  },
  {
    _id: '9580c1cd-4068-4056-903a-4019c0d36fca',
    name: '21172',
    fileUrl: '/assets/rooms/textures/library/solids/21172.jpg'
  },
  {
    _id: '8408dffd-609c-46ec-947b-8933f06300e8',
    name: '21187',
    fileUrl: '/assets/rooms/textures/library/solids/21187.jpg'
  },
  {
    _id: '0a05cf64-a60d-4a3a-8e3d-4e89602024c5',
    name: '21193',
    fileUrl: '/assets/rooms/textures/library/solids/21193.jpg'
  },
  {
    _id: 'cf465a66-efb5-4a07-bca6-fd5d503c18ef',
    name: '21307',
    fileUrl: '/assets/rooms/textures/library/solids/21307.jpg'
  },
  {
    _id: 'f58a2597-7bb2-4ef6-85bc-38853294dfe4',
    name: '21321',
    fileUrl: '/assets/rooms/textures/library/solids/21321.jpg'
  },
  {
    _id: 'fee56e50-bda8-4b62-9f50-6628bc8828b2',
    name: '21341',
    fileUrl: '/assets/rooms/textures/library/solids/21341.jpg'
  },
  {
    _id: '2b64bcb7-3cd7-49bd-84d7-62ea2c92ca61',
    name: '21387',
    fileUrl: '/assets/rooms/textures/library/solids/21387.jpg'
  },
  {
    _id: '47669cdc-a498-479d-a15c-33ef376e3b60',
    name: '21581',
    fileUrl: '/assets/rooms/textures/library/solids/21581.jpg'
  },
  {
    _id: '02a30506-9cab-495e-82ea-7b0f937e84cb',
    name: '21941',
    fileUrl: '/assets/rooms/textures/library/solids/21941.jpg'
  },
  {
    _id: 'bd9ab7da-0076-44cb-ba04-2851bd7ce880',
    name: '22017',
    fileUrl: '/assets/rooms/textures/library/solids/22017.jpg'
  },
  {
    _id: '3e566ecd-505b-4680-adf6-bb3a6ada66d8',
    name: '22059',
    fileUrl: '/assets/rooms/textures/library/solids/22059.jpg'
  },
  {
    _id: '50cfc014-fd3c-43f4-a038-b3b5545a1750',
    name: '22062',
    fileUrl: '/assets/rooms/textures/library/solids/22062.jpg'
  },
  {
    _id: '1405b755-cbf8-4ac1-b07a-574a66de22da',
    name: '22067',
    fileUrl: '/assets/rooms/textures/library/solids/22067.jpg'
  },
  {
    _id: '76d6d3e8-84fc-4469-a505-746012a82cf6',
    name: '22074',
    fileUrl: '/assets/rooms/textures/library/solids/22074.jpg'
  },
  {
    _id: 'd0fcf302-ee7c-4a79-8e35-2b1b4fbe9438',
    name: '22079',
    fileUrl: '/assets/rooms/textures/library/solids/22079.jpg'
  },
  {
    _id: '0bc7ff92-2ea1-4c59-9935-584e46ebc421',
    name: '22084',
    fileUrl: '/assets/rooms/textures/library/solids/22084.jpg'
  },
  {
    _id: '188153e6-7c92-417e-ae24-868d5c8ff4ac',
    name: '22091',
    fileUrl: '/assets/rooms/textures/library/solids/22091.jpg'
  },
  {
    _id: '85c03412-9e94-4515-acd4-2d2bf71a915d',
    name: '22099',
    fileUrl: '/assets/rooms/textures/library/solids/22099.jpg'
  },
  {
    _id: 'b2cccb64-8740-4611-9f58-5b72129954c1',
    name: '22102',
    fileUrl: '/assets/rooms/textures/library/solids/22102.jpg'
  },
  {
    _id: 'aec698da-76d1-46b6-9d7b-1460a744858b',
    name: '22103',
    fileUrl: '/assets/rooms/textures/library/solids/22103.jpg'
  },
  {
    _id: '3a248c70-96e4-4e4d-8cb0-943a77843872',
    name: '22104',
    fileUrl: '/assets/rooms/textures/library/solids/22104.jpg'
  },
  {
    _id: 'b2c83202-176b-45ed-8b2b-c8add0cff34e',
    name: '22107',
    fileUrl: '/assets/rooms/textures/library/solids/22107.jpg'
  },
  {
    _id: '92d29239-8046-4fdc-bf70-9d21cdcca3e1',
    name: '22109',
    fileUrl: '/assets/rooms/textures/library/solids/22109.jpg'
  },
  {
    _id: 'd2cd9c1b-475c-4fbe-b9f5-a7779bac7436',
    name: '22115',
    fileUrl: '/assets/rooms/textures/library/solids/22115.jpg'
  },
  {
    _id: '85edd6ba-66c7-4e0b-ac07-9286ee037a31',
    name: '22119',
    fileUrl: '/assets/rooms/textures/library/solids/22119.jpg'
  },
  {
    _id: '5942e855-905c-4ab1-8e64-e1311d664253',
    name: '22122',
    fileUrl: '/assets/rooms/textures/library/solids/22122.jpg'
  },
  {
    _id: 'e7b82b0f-64c2-42d5-9bf3-a37f916ac790',
    name: '22127',
    fileUrl: '/assets/rooms/textures/library/solids/22127.jpg'
  },
  {
    _id: '6ba8b47c-c958-4848-9d82-ba0b4c1c984f',
    name: '22129',
    fileUrl: '/assets/rooms/textures/library/solids/22129.jpg'
  },
  {
    _id: '8d95d106-13f1-4ae2-9571-d4bf5260c523',
    name: '22133',
    fileUrl: '/assets/rooms/textures/library/solids/22133.jpg'
  },
  {
    _id: 'ad42f2ca-205f-43dd-b826-bf733d57e782',
    name: '22134',
    fileUrl: '/assets/rooms/textures/library/solids/22134.jpg'
  },
  {
    _id: 'a0c48609-ade4-476e-ace6-054ff1bf0aa1',
    name: '22137',
    fileUrl: '/assets/rooms/textures/library/solids/22137.jpg'
  },
  {
    _id: '4ae911b7-6bf7-40fb-adb8-2924b2ae033f',
    name: '22142',
    fileUrl: '/assets/rooms/textures/library/solids/22142.jpg'
  },
  {
    _id: '2d90a876-003e-480c-a34a-e9310af5b197',
    name: '22143',
    fileUrl: '/assets/rooms/textures/library/solids/22143.jpg'
  },
  {
    _id: '88448e59-5e75-4b02-a7e0-36f6f8c27fdb',
    name: '22157',
    fileUrl: '/assets/rooms/textures/library/solids/22157.jpg'
  },
  {
    _id: '1165ddca-f9b3-4a25-888e-ed07a1905138',
    name: '22169',
    fileUrl: '/assets/rooms/textures/library/solids/22169.jpg'
  },
  {
    _id: 'c4bd04ca-951d-416e-8322-3eaef59de093',
    name: '22172',
    fileUrl: '/assets/rooms/textures/library/solids/22172.jpg'
  },
  {
    _id: 'fe97164d-c8c2-48fe-9fac-193b807a76ba',
    name: '22212',
    fileUrl: '/assets/rooms/textures/library/solids/22212.jpg'
  },
  {
    _id: '01104511-b83b-45ee-b002-121bcaf1d1c1',
    name: '22223',
    fileUrl: '/assets/rooms/textures/library/solids/22223.jpg'
  },
  {
    _id: 'e474a619-8ab9-4abb-a93d-d405a99dec9a',
    name: '22293',
    fileUrl: '/assets/rooms/textures/library/solids/22293.jpg'
  },
  {
    _id: 'd99f2056-3b8a-4821-9ad2-5c9fa44d823e',
    name: '24087',
    fileUrl: '/assets/rooms/textures/library/solids/24087.jpg'
  },
  {
    _id: 'e83d8890-58b3-4a20-ab7d-516f86217170',
    name: '40214',
    fileUrl: '/assets/rooms/textures/library/stone/40214.jpg'
  },
  {
    _id: 'afda90db-e022-4b0c-b44c-2f36f8ef216e',
    name: '40216',
    fileUrl: '/assets/rooms/textures/library/stone/40216.jpg'
  },
  {
    _id: '5d11ec99-44e7-4ee4-a7e0-fedd96974fef',
    name: '40232',
    fileUrl: '/assets/rooms/textures/library/stone/40232.jpg'
  },
  {
    _id: '0cddf841-300c-4801-9f51-5951f3b55efb',
    name: '40474',
    fileUrl: '/assets/rooms/textures/library/stone/40474.jpg'
  },
  {
    _id: '51760b2d-9347-4b00-bc3b-65902d3fab97',
    name: '40475',
    fileUrl: '/assets/rooms/textures/library/stone/40475.jpg'
  },
  {
    _id: '8f4db6b5-4bdc-4adc-b58e-38447c466f6a',
    name: '40478',
    fileUrl: '/assets/rooms/textures/library/stone/40478.jpg'
  },
  {
    _id: '43620662-5913-4b39-accb-51ec1ae68cda',
    name: '40499',
    fileUrl: '/assets/rooms/textures/library/stone/40499.jpg'
  },
  {
    _id: '3dfd2234-eab5-474c-813f-cd221fa48e8c',
    name: '40756',
    fileUrl: '/assets/rooms/textures/library/stone/40756.jpg'
  },
  {
    _id: 'afc3caab-2e35-40fe-b6e4-ea342daa69ee',
    name: '44279',
    fileUrl: '/assets/rooms/textures/library/stone/44279.jpg'
  },
  {
    _id: '0051c8d3-985f-4cff-8093-c7f02720f4d8',
    name: '44280',
    fileUrl: '/assets/rooms/textures/library/stone/44280.jpg'
  },
  {
    _id: 'aa59d8f3-f6b4-42f9-9269-1947a80669c2',
    name: '44281',
    fileUrl: '/assets/rooms/textures/library/stone/44281.jpg'
  },
  {
    _id: 'cc432b90-000b-4cbe-af50-880e6e269dfb',
    name: '44282',
    fileUrl: '/assets/rooms/textures/library/stone/44282.jpg'
  },
  {
    _id: '44612d83-2cf3-4a43-aaf5-113cecb14d31',
    name: '44761',
    fileUrl: '/assets/rooms/textures/library/stone/44761.jpg'
  },
  {
    _id: 'ecda0ea9-8e78-4c4f-bc22-217651eed299',
    name: '44793',
    fileUrl: '/assets/rooms/textures/library/stone/44793.jpg'
  },
  {
    _id: 'ae6ecd41-82c2-4af6-b239-cea62441609a',
    name: 'Good Earth - Paradis Charcoal',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Paradis%20Charcoal.jpeg'
  },
  {
    _id: 'acc53dde-e032-483d-a474-2c972031bc34',
    name: 'Good Earth - Peony Garden',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Peony%20Garden.jpeg'
  },
  {
    _id: 'f9ae6e6d-3305-4046-a174-8c93bc98ed13',
    name: 'Good Earth - Rosa Bagh',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Rosa%20Bagh.jpeg'
  },
  {
    _id: '796dc86f-91df-4d09-9c34-b7b3ad0142e4',
    name: 'Good Earth - Samarqand Ivory',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20Earth%20-%20Samarqand%20Ivory.jpeg'
  },
  {
    _id: 'b9a4728f-49a6-45b5-b8f6-853540decd6b',
    name: 'Good Earth - Qila',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Good%20earth%20qila.jpeg'
  },
  {
    _id: '39515851-4dc5-4e38-b5e7-b79c1cb4112b',
    name: 'Novamur Ivy - Demure Stripes',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Novamur%20Ivy%20-%20Demure%20Stripes.jpeg'
  },
  {
    _id: '846d4b2d-6486-4d0d-a9d3-433df0d61373',
    name: 'Novamur Ivy - Lettering Structures',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Novamur%20Ivy%20-%20Lettering%20Structure.jpeg'
  },
  {
    _id: 'ac1220fb-7e9b-4b14-b3d3-157457a64fd8',
    name: 'Signatures - April Showers - Intense Ocean',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Signatures%20-%20April%20Showers%20-%20Intense%20Ocean.jpeg'
  },
  {
    _id: '37b536d8-0fb5-4804-912f-fcbe84c1575b',
    name: 'Signatures - April Showers Madder',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Signatures%20-%20Aprl%20Shw%20Madder.jpeg',
    updatedAt: '2023-11-24T15:54:49.421Z'
  },
  {
    _id: 'd79ec1e9-0c37-476f-858b-bc8a2e56cc97',
    name: 'Signatures - Gilded Memories - Gold on Grey',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Signatures%20-%20Gilded%20Memories-%20Gold%20on%20Grey.jpeg'
  },
  {
    _id: '95b0b41e-421f-4c57-bf21-e54b4b2d0585',
    name: 'Signatures - Gilded Memories - Gold on Night Grey',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Signatures%20-%20Gilded%20Memories-%20Gold%20on%20Night%20Grey.jpeg'
  },
  {
    _id: 'd95f2da2-b109-42df-ab91-0787b13bc6a4',
    name: 'Signatures - Rain Dance Bw',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Signatures%20-%20Rain%20Dance%20Bw.jpeg'
  },
  {
    _id: '3add9cca-ce6a-4e6c-936e-4dd9fad39233',
    name: 'Signatures - Rain Dance Indigo',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Signatures%20-%20Rain%20Dnc%20Indigo.jpeg'
  },
  {
    _id: '71b0d8a7-8a60-411b-b66b-f338a5db2b58',
    name: 'Signatures - Soak Turquoise',
    fileUrl:
      '/assets/rooms/textures/library/wallpapers/Signatures%20-%20Soak%20Turquoise.jpeg'
  },
  {
    _id: '2fba5ba9-2a75-4bde-9b58-96f507ae8dce',
    name: '10016',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10016.jpg'
  },
  {
    _id: 'a6f11c92-6ab6-4e8f-86a8-77ddd7ce4493',
    name: '10019',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10019.jpg'
  },
  {
    _id: '2c16aeb3-cb0e-463f-92d3-0d78632209f0',
    name: '10024',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10024.jpg'
  },
  {
    _id: '1cca8f2c-01f3-46ce-9521-88594492c12f',
    name: '10031',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10031.jpg'
  },
  {
    _id: 'dfc35ab6-6b1b-41eb-bf5e-0c714fdd1e96',
    name: '10036',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10036.jpg'
  },
  {
    _id: '00f86e2d-b486-4f86-943f-e3cde43b1766',
    name: '10039',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10039.jpg'
  },
  {
    _id: 'c9a2864e-a100-495d-92f7-2a564df22210',
    name: '10073',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10073.jpg'
  },
  {
    _id: 'c1e7f96e-463d-4df1-a2f2-b740854d2dcf',
    name: '10081',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10081.jpg'
  },
  {
    _id: '0a610823-b3b7-46bf-b525-d3541cd191c2',
    name: '10091',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10091.jpg'
  },
  {
    _id: '90192ac6-56a6-4c0a-bb3c-e7b3acc97dc7',
    name: '10098',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10098.jpg'
  },
  {
    _id: '5abd9ce6-cd6a-47c3-a7c8-2c9f0319bcc1',
    name: '10099',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10099.jpg'
  },
  {
    _id: 'b7785bd2-6129-4a69-a6e4-f832d9c5dab5',
    name: '10145',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10145.jpg'
  },
  {
    _id: '17bec18a-b3d0-4064-bbc0-de4b275d771a',
    name: '10159',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10159.jpg'
  },
  {
    _id: '60ae45a0-0e14-473c-b018-bc404ce2f48b',
    name: '10164',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10164.jpg'
  },
  {
    _id: '77cb918d-a9a4-48f3-adf7-ba68598a207a',
    name: '10168',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10168.jpg'
  },
  {
    _id: '955fa485-834d-4dbe-b40e-58069be8918c',
    name: '10184',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10184.jpg'
  },
  {
    _id: 'f2f31067-856a-4dec-a113-c18d400e48a8',
    name: '10185',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10185.jpg'
  },
  {
    _id: 'ee7c38d8-d390-4bde-86b4-179afec9a4b4',
    name: '10189',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10189.jpg'
  },
  {
    _id: '3b1287be-21ef-4ec8-b2ec-b533e360680c',
    name: '10197',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10197.jpg'
  },
  {
    _id: '5b40dee7-9322-4d52-b16c-b46d6a00f7b3',
    name: '10241',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10241.jpg'
  },
  {
    _id: 'c9826763-2109-47c0-b2d1-05c56e1d8503',
    name: '10515',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10515.jpg'
  },
  {
    _id: '5151e67a-b72b-487c-9d4f-f092795438f7',
    name: '10516',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10516.jpg'
  },
  {
    _id: 'b8fb5e20-8479-4f61-adb3-44d4332478f6',
    name: '10517',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10517.jpg'
  },
  {
    _id: '43dee57a-73a8-47d0-b3de-d00739abb84e',
    name: '10523',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10523.jpg'
  },
  {
    _id: '07d377b1-4c7b-4f50-baa8-c60d5ae7153e',
    name: '10573',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10573.jpg'
  },
  {
    _id: '9c09322d-c5f1-4b1a-a214-8a5e2b6609df',
    name: '10592',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10592.jpg'
  },
  {
    _id: '1a54be23-f719-4937-b3ad-90f6ff0e3a91',
    name: '10659',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10659.jpg'
  },
  {
    _id: 'b106b691-8552-4fce-83e5-abdafe38219e',
    name: '10680',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10680.jpg'
  },
  {
    _id: 'ddea66b9-5a61-44a6-93a3-7d4aba3478a9',
    name: '10699',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10699.jpg'
  },
  {
    _id: '8d84b519-fa06-430c-b591-185f9ce64331',
    name: '10858',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10858.jpg'
  },
  {
    _id: '38a2ff58-7467-43ed-9eb4-59964f297747',
    name: '10884',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/10884.jpg'
  },
  {
    _id: '46480e72-57d3-42c6-a1e8-d308ed133da8',
    name: '11682',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/11682.jpg'
  },
  {
    _id: 'ad8b81a8-eaf4-41e1-a154-c6a0f221618f',
    name: '14008',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14008.jpg'
  },
  {
    _id: 'e9ffd610-7745-4877-8039-571018027d6b',
    name: '14010',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14010.jpg'
  },
  {
    _id: '4fed499b-0924-40ed-9788-38792280b0cf',
    name: '14011',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14011.jpg'
  },
  {
    _id: '60e6923b-e841-4c3f-b669-89316c6c4d67',
    name: '14134',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14134.jpg'
  },
  {
    _id: '8b61b68f-f9ee-4584-9ff5-8f1c9afaa072',
    name: '14143',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14143.jpg'
  },
  {
    _id: 'a852887f-976f-415b-959c-f3f1d7049fa3',
    name: '14177',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14177.jpg'
  },
  {
    _id: 'fb32ea2d-2ffe-4a60-8c11-8d42340c6d87',
    name: '14533',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14533.jpg'
  },
  {
    _id: '40a6cd4d-4905-4764-bd04-f1c7f6ad2ca0',
    name: '14624',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14624.jpg'
  },
  {
    _id: '0604c4f7-b883-4107-8008-6013a164bff3',
    name: '14625',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14625.jpg'
  },
  {
    _id: '3009ea31-fdaa-43f4-9b36-575069a56a2a',
    name: '14670',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14670.jpg'
  },
  {
    _id: '89898cbb-e421-4ce7-8f38-e9bf3fad9214',
    name: '14810',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14810.jpg'
  },
  {
    _id: 'c67a3eea-589e-4870-bf56-e0ed995977f7',
    name: '14920',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14920.jpg'
  },
  {
    _id: '6bb8f97a-6913-4132-9db7-7bad0a450039',
    name: '14921',
    fileUrl: '/assets/rooms/textures/library/wooden_grains/14921.jpg'
  }
]

const createTexturesOnDB = async () => {
  let textureCategories = await app.service('texturecategories').find({})
  if (textureCategories?.data?.length) {
    const textureCategory = textureCategories.data.find((textureCategory) =>
      textureCategory.name.toLowerCase().includes('glossy')
    )
    await Promise.all(
      texturesList.map(async (texture) => {
        await app.service('textures').create({ ...texture, textureCategoryId: textureCategory._id })
      })
    )
    return true
  }
  return true
}

// createTexturesOnDB()
