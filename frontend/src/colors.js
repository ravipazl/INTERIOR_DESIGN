$(document).ready(function() {
    const colors = [
        {
            texture: 'textures/uv.png',
            size: [1, 1, 1],
            shininess: 0
        },
        {
            texture: 'textures/Wood_001.jpg',
            size: [1, 1, 1],
            shininess: 0
        },

        {
            texture: 'textures/fabric_.jpg',
            size: [1, 1, 1],
            shininess: 0
        },

        {
            texture: 'textures/pattern_.jpg',
            size: [1, 1, 1],
            shininess: 0
        },

        {
            texture: 'textures/denim_.jpg',
            size: [1, 1, 1],
            shininess: 0
        },

        {
            texture: 'textures/quilt_.jpg',
            size: [1, 1, 1],
            shininess: 0
        },
        {
            texture: 'textures/Counter_Top.jpg',
            size: [1, 1, 1],
            shininess: 0
        },
        {
            texture: 'textures/Handle.jpg',
            size: [1, 1, 1],
            shininess: 0
        },
        {
            texture: 'textures/Shutter.jpg',
            size: [0.1, 1, 1],
            shininess: 0
        },
        {
            texture: 'textures/Skirting.jpg',
            size: [1, 1, 1],
            shininess: 0
        }
    ];
    let itemsDiv = $("#colorPlate");
    for (var i = 0; i < colors.length; i++) {
        let colorlist = colors[i];
        let color = (colorlist.color) ? colorlist.color : '';
        let texture = (colorlist.texture) ? colorlist.texture : '';
        let size = (colorlist.size) ? colorlist.size : '';
        let shininess = (colorlist.shininess) ? colorlist.shininess : 10;
        let swatch = document.createElement('li');
        swatch.classList.add('addColors');
        if (texture) {
            swatch.style.backgroundImage = "url(" + texture + ")";
        } else {
            swatch.style.background = "#" + color;
        }
        swatch.setAttribute('data-color', color);
        swatch.setAttribute('data-texture', texture);
        swatch.setAttribute('data-size', JSON.stringify(size));
        swatch.setAttribute('data-shininess', shininess);
        itemsDiv.append(swatch);
    }

});