$(document).ready(function() {
    var items = [{
            "name": "1A_Base_Unit_Shelf_150",
            "image": "models/thumbnails/basic.png",
            "model": "models/1A_Base_Unit_Shelf_150.glb",
            "type": "1",
            "format": "gltf",
            "size": [15.000,
                81.500,
                60.000
            ]
        },
        { "name": "1B_Base_Unit_Shelf_300", "image": "models/thumbnails/basic.png", "model": "models/1B_Base_Unit_Shelf_300.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "1C_Base_Unit_Shelf_450", "image": "models/thumbnails/basic.png", "model": "models/1C_Base_Unit_Shelf_450.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "1D_Base_Unit_Shelf_600", "image": "models/thumbnails/basic.png", "model": "models/1D_Base_Unit_Shelf_600.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "1E_Base_Unit_Shelf_750", "image": "models/thumbnails/basic.png", "model": "models/1E_Base_Unit_Shelf_750.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "1F_Base_Unit_Shelf_900", "image": "models/thumbnails/basic.png", "model": "models/1F_Base_Unit_Shelf_900.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "1G_Base_Unit_Shelf_1050", "image": "models/thumbnails/basic.png", "model": "models/1G_Base_Unit_Shelf_1050.glb", "type": "1", "format": "gltf", "size": [] },


        { "name": "2A_Base_Unit_Drawer_Shelf_150", "image": "models/thumbnails/basic.png", "model": "models/2A_Base_Unit_Drawer_Shelf_150.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "2B_Base_Unit_Drawer_Shelf_300", "image": "models/thumbnails/basic.png", "model": "models/2B_Base_Unit_Drawer_Shelf_300.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "2C_Base_Unit_Drawer_Shelf_450", "image": "models/thumbnails/basic.png", "model": "models/2C_Base_Unit_Drawer_Shelf_450.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "2D_Base_Unit_Drawer_Shelf_600", "image": "models/thumbnails/basic.png", "model": "models/2D_Base_Unit_Drawer_Shelf_600.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "2E_Base_Unit_Drawer_Shelf_750", "image": "models/thumbnails/basic.png", "model": "models/2E_Base_Unit_Drawer_Shelf_750.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "2F_Base_Unit_Drawer_Shelf_900", "image": "models/thumbnails/basic.png", "model": "models/2F_Base_Unit_Drawer_Shelf_900.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "2G_Base_Unit_Drawer_Shelf_1050", "image": "models/thumbnails/basic.png", "model": "models/2G_Base_Unit_Drawer_Shelf_1050.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "2H_Base_Unit_Drawer_Shelf_1200", "image": "models/thumbnails/basic.png", "model": "models/2H_Base_Unit_Drawer_Shelf_1200.glb", "type": "1", "format": "gltf", "size": [] },

        { "name": "3A_Base_Unit_Drawer_Unit_1_150_SB.skp", "image": "models/thumbnails/basic.png", "model": "models/3A_Base_Unit_Drawer_Unit_1_150_SB.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "3B_Base_Unit_Drawer_Unit_1_300_SB.skp", "image": "models/thumbnails/basic.png", "model": "models/3B_Base_Unit_Drawer_Unit_1_300_SB.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "3C_Base_Unit_Drawer_Unit_1_450_SB.skp", "image": "models/thumbnails/basic.png", "model": "models/3C_Base_Unit_Drawer_Unit_1_450_SB.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "3D_Base_Unit_Drawer_Unit_1_600_SB.skp", "image": "models/thumbnails/basic.png", "model": "models/3D_Base_Unit_Drawer_Unit_1_600_SB.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "3E_Base_Unit_Drawer_Unit_1_750_SB.skp", "image": "models/thumbnails/basic.png", "model": "models/3E_Base_Unit_Drawer_Unit_1_750_SB.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "3F_Base_Unit_Drawer_Unit_1_900_SB.skp", "image": "models/thumbnails/basic.png", "model": "models/3F_Base_Unit_Drawer_Unit_1_900_SB.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "3G_Base_Unit_Drawer_Unit_1_1050_SB.skp", "image": "models/thumbnails/basic.png", "model": "models/3G_Base_Unit_Drawer_Unit_1_1050_SB.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "3H_Base_Unit_Drawer_Unit_1_1200_SB.skp", "image": "models/thumbnails/basic.png", "model": "models/3H_Base_Unit_Drawer_Unit_1_1200_SB.skp.glb", "type": "1", "format": "gltf", "size": [] },

        { "name": "4A_Base_Unit_Drawer_Unit_2_150_2_EQL.skp", "image": "models/thumbnails/basic.png", "model": "models/4A_Base_Unit_Drawer_Unit_2_150_2_EQL.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "4B_Base_Unit_Drawer_Unit_2_300_2_EQL.skp", "image": "models/thumbnails/basic.png", "model": "models/4B_Base_Unit_Drawer_Unit_2_300_2_EQL.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "4C_Base_Unit_Drawer_Unit_2_450_2_EQL.skp", "image": "models/thumbnails/basic.png", "model": "models/4C_Base_Unit_Drawer_Unit_2_450_2_EQL.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "4D_Base_Unit_Drawer_Unit_2_600_2_EQL.skp", "image": "models/thumbnails/basic.png", "model": "models/4D_Base_Unit_Drawer_Unit_2_600_2_EQL.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "4E_Base_Unit_Drawer_Unit_2_750_2_EQL.skp", "image": "models/thumbnails/basic.png", "model": "models/4E_Base_Unit_Drawer_Unit_2_750_2_EQL.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "4F_Base_Unit_Drawer_Unit_2_900_2_EQL.skp", "image": "models/thumbnails/basic.png", "model": "models/4F_Base_Unit_Drawer_Unit_2_900_2_EQL.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "4G_Base_Unit_Drawer_Unit_2_1050_2_EQL.skp", "image": "models/thumbnails/basic.png", "model": "models/4G_Base_Unit_Drawer_Unit_2_1050_2_EQL.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "4H_Base_Unit_Drawer_Unit_2_1200_2_EQL.skp", "image": "models/thumbnails/basic.png", "model": "models/4H_Base_Unit_Drawer_Unit_2_1200_2_EQL.skp.glb", "type": "1", "format": "gltf", "size": [] },

        { "name": "23A_Tall_Unit_2_With_Door_and_6_Drawers_300.skp", "image": "models/thumbnails/basic.png", "model": "models/23A_Tall_Unit_2_With_Door_and_6_Drawers_300.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "23B_Tall_Unit_2_With_Door_and_6_Drawers_450.skp", "image": "models/thumbnails/basic.png", "model": "models/23B_Tall_Unit_2_With_Door_and_6_Drawers_450.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "23C_Tall_Unit_2_With_Door_and_6_Drawers_600.skp", "image": "models/thumbnails/basic.png", "model": "models/23C_Tall_Unit_2_With_Door_and_6_Drawers_600.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "23D_Tall_Unit_2_With_Door_and_6_Drawers_750.skp", "image": "models/thumbnails/basic.png", "model": "models/23D_Tall_Unit_2_With_Door_and_6_Drawers_750.skp.glb", "type": "1", "format": "gltf", "size": [] },

        { "name": "24A_Pantry_Tall_Unit_1_With_Door_300.skp", "image": "models/thumbnails/basic.png", "model": "models/24A_Pantry_Tall_Unit_1_With_Door_300.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "24B_Pantry_Tall_Unit_1_With_Door_450.skp", "image": "models/thumbnails/basic.png", "model": "models/24B_Pantry_Tall_Unit_1_With_Door_450.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "24C_Pantry_Tall_Unit_1_With_Door_600.skp", "image": "models/thumbnails/basic.png", "model": "models/24C_Pantry_Tall_Unit_1_With_Door_600.skp.glb", "type": "1", "format": "gltf", "size": [] },


        { "name": "25A_Tall_Unit_1_With_Door_2SD_1BD_300.skp", "image": "models/thumbnails/basic.png", "model": "models/25A_Tall_Unit_1_With_Door_2SD_1BD_300.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "25B_Tall_Unit_1_With_Door_2SD_1BD_450.skp", "image": "models/thumbnails/basic.png", "model": "models/25B_Tall_Unit_1_With_Door_2SD_1BD_450.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "25C_Tall_Unit_1_With_Door_2SD_1BD_600.skp", "image": "models/thumbnails/basic.png", "model": "models/25C_Tall_Unit_1_With_Door_2SD_1BD_600.skp.glb", "type": "1", "format": "gltf", "size": [] },
        { "name": "25D_Tall_Unit_1_With_Door_2SD_1BD_750.skp", "image": "models/thumbnails/basic.png", "model": "models/25D_Tall_Unit_1_With_Door_2SD_1BD_750.skp.glb", "type": "1", "format": "gltf", "size": [] },


        { "name": "Sofa.skp", "image": "models/thumbnails/basic.png", "model": "models/sofaT.glb", "type": "1", "format": "gltf", "size": [] },

    ];
    var modelTypesNum = ["0", "1", "2", "3", "4", "7", "8", "9"];

    var modelTypesIds = ["item-items", "floor-items", "wall-items", "in-wall-items", "roof-items", "in-wall-floor-items", "on-floor-items", "wall-floor-items"];

    var itemsDiv = $("#items-wrapper");



    for (var i = 0; i < items.length; i++)

    {
        var item = items[i];
        var type = modelTypesIds[modelTypesNum.indexOf(item.type)];
        var divname = (type == 'floor-items') ? 'floor' : 'wall';
        var modelformat = (item.format) ? ' model-format="' + item.format + '"' : "";
        var html = '<li class="add-item" model-image="' + item.image + '" model-name="' + item.name + '"' + ' model-url="' + item.model + '"' + ' model-type="' + item.type + '"' + modelformat + ' ><img src="' + item.image + '" alt="add items" /><h5>' + item.name.substring(0, 15) + '..</h5><h6>Rs 4,800</h6></li>'
        var itemsDiv1 = $("#" + divname + ' .itemlist');
        itemsDiv1.append(html);
    }

});