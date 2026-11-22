from ursina import Entity, Text, camera, color


def build_ui(HOTBAR, BLOCK_TYPES):
    title_text = Text('BLOCKWELT', parent=camera.ui, x=-.85, y=.45, scale=1.35,
                      color=color.white)
    help_text = Text('WASD: Gehen | Maus: Blick | Leertaste: Springen',
                     parent=camera.ui, x=-.85, y=.405, scale=.7, color=color.white)
    slots: list[Entity] = []
    for i, block in enumerate(HOTBAR):
        x = (i - (len(HOTBAR) - 1) / 2) * .115
        frame = Entity(parent=camera.ui, model='quad', position=(x, -.425),
                       scale=(.105, .105), color=color.rgba(34, 39, 48, 235))
        Entity(parent=frame, model='quad', z=-.01, scale=(.74, .74),
               color=color.rgb(*BLOCK_TYPES[block][1]))
        Text(str(i + 1), parent=camera.ui, position=(x - .045, -.39),
             scale=.72, color=color.white)
        slots.append(frame)
    return title_text, help_text, slots
