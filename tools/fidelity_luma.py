import numpy as np
import ctypes
from pathlib import Path

_accelerator=None
if Path(__file__).with_name('fidelity_luma_native.dll').exists():
    _library=ctypes.CDLL(str(Path(__file__).with_name('fidelity_luma_native.dll')))
    _accelerator=_library.fidelity_luma
    _accelerator.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_float]
    _accelerator.restype=None


def enhance_luma(plane, seconds):
    if plane.ndim!=2 or plane.dtype!=np.uint8:
        raise ValueError('Expected a native eight-bit luma plane')
    if seconds<=1 or seconds>=6:return plane.copy()
    if _accelerator is None:return enhance_luma_numpy(plane,seconds)
    source=np.ascontiguousarray(plane)
    result=source.copy();horizontal=np.empty(source.shape,np.float32)
    start=np.clip((seconds-1)/.25,0,1);end=np.clip((6-seconds)/.25,0,1)
    fade=start*start*(3-2*start)*end*end*(3-2*end)
    _accelerator(source.ctypes.data,horizontal.ctypes.data,result.ctypes.data,plane.shape[1],plane.shape[0],float(fade))
    return result


def enhance_luma_numpy(plane, seconds):
    if plane.ndim!=2 or plane.dtype!=np.uint8:
        raise ValueError('Expected a native eight-bit luma plane')
    if seconds<=1 or seconds>=6:return plane.copy()
    height,width=plane.shape
    original=plane.astype(np.float32)
    horizontal=np.pad(original,((0,0),(2,2)),mode='edge')
    blur=(horizontal[:,:width]+4*horizontal[:,1:width+1]+6*horizontal[:,2:width+2]
          +4*horizontal[:,3:width+3]+horizontal[:,4:width+4])/16
    vertical=np.pad(blur,((2,2),(0,0)),mode='edge')
    blur=(vertical[:height]+4*vertical[1:height+1]+6*vertical[2:height+2]
          +4*vertical[3:height+3]+vertical[4:height+4])/16
    padded=np.pad(original,((1,1),(1,1)),mode='edge')
    low=np.minimum(np.minimum(padded[:,0:width],padded[:,1:width+1]),padded[:,2:width+2])
    high=np.maximum(np.maximum(padded[:,0:width],padded[:,1:width+1]),padded[:,2:width+2])
    low=np.minimum(np.minimum(low[:height],low[1:height+1]),low[2:height+2])
    high=np.maximum(np.maximum(high[:height],high[1:height+1]),high[2:height+2])
    detail=original-blur
    # Continuous gates avoid an artificial threshold switching on/off across frames.
    weight=1/(1+((high-low)/96)**4)
    detail*=np.abs(detail)/(np.abs(detail)+1)
    start=np.clip((seconds-1)/.25,0,1);end=np.clip((6-seconds)/.25,0,1)
    fade=start*start*(3-2*start)*end*end*(3-2*end)
    delta=np.clip(detail*.45*weight*fade,-3,3)
    result=np.rint(np.minimum(np.maximum(original+delta,low),high)).astype(np.uint8)
    result[(plane>0)&(result==0)]=1
    result[(plane<255)&(result==255)]=254
    result[height*5//6:]=plane[height*5//6:]
    result[:2]=plane[:2];result[-2:]=plane[-2:]
    result[:,:2]=plane[:,:2];result[:,-2:]=plane[:,-2:]
    return result
