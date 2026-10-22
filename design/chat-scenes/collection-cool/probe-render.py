import bpy,json
p=bpy.context.preferences.addons['cycles'].preferences
result={}
for kind in ['OPTIX','CUDA']:
    try:
        p.compute_device_type=kind;p.get_devices()
        result[kind]=[{'name':d.name,'type':d.type,'use':d.use} for d in p.devices]
    except Exception as e:result[kind]={'error':str(e)}
print('VG_GPU_PROBE '+json.dumps(result))
