"""
Procedural 3D Circular Audio Visualizer Mesh for Blender.
Executed via: blender -b -P render.py -- --out output.mp4
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
    bar_count = int(args.get('bar_count', '32'))
    radius = float(args.get('radius', '3.0'))
    out_path = args.get('out', 'visualizer.mp4')
    fps = int(args.get('fps', '30'))
    total_frames = int(args.get('frames', '90'))

    # Reset
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = total_frames
    scene.render.fps = fps

    # Create Radial Bars
    bars = []
    for i in range(bar_count):
        angle = (2 * math.pi / bar_count) * i
        x = radius * math.cos(angle)
        y = radius * math.sin(angle)

        bpy.ops.mesh.primitive_cube_add(size=0.1, location=(x, y, 0))
        bar = bpy.context.active_object
        bar.name = f"Bar_{i}"
        bar.rotation_euler = (0, 0, angle + math.pi/2)
        bars.append(bar)

        # Keyframe Procedural Heights
        for f in range(1, total_frames + 1, 5):
            h = 0.5 + 2.0 * math.sin(f * 0.2 + i * 0.4) ** 2
            bar.scale = (1.0, 1.0, h)
            bar.keyframe_insert(data_path="scale", frame=f)

    # Cyan Emission Material
    mat = bpy.data.materials.new(name="GlowMat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new(type='ShaderNodeEmission')
    emission.inputs['Color'].default_value = (0.0, 0.94, 1.0, 1.0)
    emission.inputs['Strength'].default_value = 5.0
    output = nodes.new(type='ShaderNodeOutputMaterial')
    mat.node_tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])

    for bar in bars:
        bar.data.materials.append(mat)

    # Overhead Camera Orbit
    cam_data = bpy.data.cameras.new("Camera")
    cam_obj = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    cam_obj.location = (0, -6.5, 4.0)
    cam_obj.rotation_euler = (math.radians(60), 0, 0)

    # Render settings
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.filepath = out_path

if __name__ == '__main__':
    build_scene()
