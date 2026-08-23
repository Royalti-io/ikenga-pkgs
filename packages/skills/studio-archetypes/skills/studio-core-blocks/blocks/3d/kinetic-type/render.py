"""
Procedural 3D Kinetic Typography Render Script for Blender.
Executed via: blender -b -P render.py -- --text "..." --out output.mp4
"""

import bpy
import sys
import math

def parse_args():
    args = {}
    argv = sys.argv
    if '--' in argv:
        cli_args = argv[argv.index('--') + 1:]
        for i in range(0, len(cli_args), 2):
            if i + 1 < len(cli_args) and cli_args[i].startswith('--'):
                args[cli_args[i][2:]] = cli_args[i + 1]
    return args

def build_scene():
    args = parse_args()
    text_content = args.get('text', 'IKENGA STUDIO')
    extrude_amount = float(args.get('extrude', '0.15'))
    bevel_depth = float(args.get('bevel', '0.02'))
    out_path = args.get('out', 'render.mp4')
    fps = int(args.get('fps', '30'))
    total_frames = int(args.get('frames', '90'))

    # Reset
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = total_frames
    scene.render.fps = fps

    # Create Text Curve Object
    font_curve = bpy.data.curves.new(type="FONT", name="FontCurve")
    font_curve.body = text_content
    font_curve.extrude = extrude_amount
    font_curve.bevel_depth = bevel_depth
    font_curve.align_x = 'CENTER'
    font_curve.align_y = 'MIDDLE'

    text_obj = bpy.data.objects.new(name="TextObject", object_data=font_curve)
    scene.collection.objects.link(text_obj)
    text_obj.location = (0, 0, 0)

    # Material
    mat = bpy.data.materials.new(name="TextMaterial")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    if principled:
        principled.inputs['Base Color'].default_value = (1.0, 0.42, 0.0, 1.0) # Ikenga orange
        principled.inputs['Metallic'].default_value = 0.8
        principled.inputs['Roughness'].default_value = 0.2
    text_obj.data.materials.append(mat)

    # Camera
    cam_data = bpy.data.cameras.new("Camera")
    cam_obj = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    # Camera Animation (Dolly Zoom & Orbit)
    cam_obj.location = (0, -6.0, 0.5)
    cam_obj.rotation_euler = (math.radians(85), 0, 0)
    cam_obj.keyframe_insert(data_path="location", frame=1)
    cam_obj.keyframe_insert(data_path="rotation_euler", frame=1)

    cam_obj.location = (0.5, -3.5, 0.8)
    cam_obj.rotation_euler = (math.radians(78), math.radians(5), math.radians(-8))
    cam_obj.keyframe_insert(data_path="location", frame=total_frames)
    cam_obj.keyframe_insert(data_path="rotation_euler", frame=total_frames)

    # Key & Fill Lights
    key_light = bpy.data.lights.new("KeyLight", type='AREA')
    key_light.energy = 800
    key_obj = bpy.data.objects.new("KeyLight", key_light)
    key_obj.location = (-3, -4, 4)
    scene.collection.objects.link(key_obj)

    fill_light = bpy.data.lights.new("FillLight", type='AREA')
    fill_light.energy = 400
    fill_obj = bpy.data.objects.new("FillLight", fill_light)
    fill_obj.location = (4, -3, 2)
    scene.collection.objects.link(fill_obj)

    # Render settings
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.filepath = out_path

if __name__ == '__main__':
    build_scene()
