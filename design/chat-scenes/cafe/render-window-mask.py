"""True camera/depth occlusion mask, including chair, mullions and leaves."""
import bpy
from pathlib import Path
HERE=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(HERE/'VirtuGene-Cafe-Original.blend'))
s=bpy.context.scene
s.render.resolution_x=1440;s.render.resolution_y=3200;s.render.resolution_percentage=100
s.render.film_transparent=False;s.cycles.samples=8;s.cycles.use_denoising=False
s.render.dither_intensity=0
s.view_settings.view_transform='Standard';s.view_settings.look='None';s.view_settings.exposure=0;s.view_settings.gamma=1
s.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=0
def flat(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear()
    e=n.new('ShaderNodeEmission');e.inputs['Color'].default_value=(*color,1);e.inputs['Strength'].default_value=1
    o=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],o.inputs['Surface']);return m
black=flat('Mask occluder BLACK',(0,0,0));white=flat('Visible window WHITE',(1,1,1))
for o in s.objects:
    if o.type=='LIGHT':o.data.energy=0
    elif o.type in ['MESH','CURVE']:
        o.hide_render=False;o.data.materials.clear();o.data.materials.append(black)
bpy.ops.mesh.primitive_cube_add(size=1,location=(1.71,2.70,1.985))
o=bpy.context.object;o.name='Window opening semantic visibility plane';o.dimensions=(2.38,.005,2.09);o.data.materials.append(white)
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA'
s.render.filepath=str(HERE/'window-occlusion-mask.png');bpy.ops.render.render(write_still=True)
o.hide_render=True
for obj in s.objects:
    if obj.name.startswith(('Window left jamb','Window right jamb','Window sill','Window top rail','Window center mullion','Window transom')):
        obj.data.materials.clear();obj.data.materials.append(white)
s.render.filepath=str(HERE/'casing-occlusion-mask.png');bpy.ops.render.render(write_still=True)
