"""
Procedural 3D Anchor Plate Generator for Blender.
Executed via: blender -b -P render.py -- --mesh asset.glb --angle three_quarter_left --out anchor.png
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
    mesh_path = args.get('mesh')
    angle = args.get('angle', 'three_quarter_left')
    out_path = args.get('out', 'anchor.png')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    if mesh_path:
        if mesh_path.endswith('.glb') or mesh_path.endswith('.gltf'):
            bpy.ops.import_scene.gltf(filepath=mesh_path)
        elif mesh_path.endswith('.obj'):
            bpy.ops.wm.obj_import(filepath=mesh_path)

    # Camera Setup
    cam_data = bpy.data.cameras.new("Camera")
    cam_obj = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    cam_dist = 4.0
    if angle == 'front':
        cam_obj.location = (0, -cam_dist, 1.0)
        cam_obj.rotation_euler = (math.radians(80), 0, 0)
    elif angle == 'three_quarter_left':
        cam_obj.location = (-cam_dist * 0.7, -cam_dist * 0.7, 1.0)
        cam_obj.rotation_euler = (math.radians(80), 0, math.radians(-45))
    elif angle == 'three_quarter_right':
        cam_obj.location = (cam_dist * 0.7, -cam_dist * 0.7, 1.0)
        cam_obj.rotation_euler = (math.radians(80), 0, math.radians(45))
    elif angle == 'profile':
        cam_obj.location = (cam_dist, 0, 1.0)
        cam_obj.rotation_euler = (math.radians(80), 0, math.radians(90))

    # 3-Point Lighting
    key_light = bpy.data.lights.new("KeyLight", type='AREA')
    key_light.energy = 500
    key_obj = bpy.data.objects.new("KeyLight", key_light)
    key_obj.location = (-2, -3, 3)
    scene.collection.objects.link(key_obj)

    fill_light = bpy.data.lights.new("FillLight", type='AREA')
    fill_light.energy = 250
    fill_obj = bpy.data.objects.new("FillLight", fill_light)
    fill_obj.location = (3, -2, 2)
    scene.collection.objects.link(fill_obj)

    rim_light = bpy.data.lights.new("RimLight", type='SPOT')
    rim_light.energy = 400
    rim_obj = bpy.data.objects.new("RimLight", rim_light)
    rim_obj.location = (0, 3, 3)
    scene.collection.objects.link(rim_obj)

    # Render settings
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)

if __name__ == '__main__':
    build_scene()
