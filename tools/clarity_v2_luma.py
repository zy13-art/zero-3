"""Bounded native-grid unsharp pass; no generated/reconstructed texture.

The wide binomial kernel (sigma=sqrt(6), support 25) matches the enlarged
soft contours much better than the previous five-tap, sigma=1 pass.
"""
import ctypes
import math
from pathlib import Path
import numpy as np

KERNEL=np.array([math.comb(24,k) for k in range(25)],np.float64)/(2**24)
_accelerator=None
_library_path=Path(__file__).with_name('clarity_v2_native.dll')
if _library_path.exists():
    _library=ctypes.CDLL(str(_library_path))
    _accelerator=_library.clarity_v2_luma
    _accelerator.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_double]
    _accelerator.restype=None


def fade_at(seconds):
    start=float(np.clip((seconds-1)/.25,0,1));end=float(np.clip((6-seconds)/.25,0,1))
    return start*start*(3-2*start)*end*end*(3-2*end)


def enhance_luma(plane,seconds):
    if plane.ndim!=2 or plane.dtype!=np.uint8:
        raise ValueError('Expected a native eight-bit luma plane')
    if seconds<=1 or seconds>=6:return plane.copy()
    if _accelerator is None:return enhance_luma_numpy(plane,seconds)
    source=np.ascontiguousarray(plane);result=source.copy()
    horizontal=np.empty(source.shape,np.float64)
    _accelerator(source.ctypes.data,horizontal.ctypes.data,result.ctypes.data,plane.shape[1],plane.shape[0],fade_at(seconds))
    return result


def enhance_luma_numpy(plane,seconds):
    if plane.ndim!=2 or plane.dtype!=np.uint8:
        raise ValueError('Expected a native eight-bit luma plane')
    if seconds<=1 or seconds>=6:return plane.copy()
    height,width=plane.shape;original=plane.astype(np.float64)
    padded=np.pad(original,((0,0),(12,12)),mode='edge');horizontal=np.zeros_like(original)
    for k,weight in enumerate(KERNEL):horizontal+=padded[:,k:k+width]*weight
    padded=np.pad(horizontal,((12,12),(0,0)),mode='edge');blur=np.zeros_like(original)
    for k,weight in enumerate(KERNEL):blur+=padded[k:k+height]*weight
    padded=np.pad(original,((2,2),(2,2)),mode='edge');low=original.copy();high=original.copy()
    for dy in range(5):
        for dx in range(5):
            patch=padded[dy:dy+height,dx:dx+width]
            np.minimum(low,patch,out=low);np.maximum(high,patch,out=high)
    detail=original-blur;absolute=np.abs(detail)
    weight=1/(1+((high-low)/128)**4)
    delta=np.clip(detail*(absolute/(absolute+.75))*1.15*weight*fade_at(seconds),-10,10)
    result=np.rint(np.clip(original+delta,low,high)).astype(np.uint8)
    result[(plane>0)&(result==0)]=1;result[(plane<255)&(result==255)]=254
    result[height*5//6:]=plane[height*5//6:]
    result[:2]=plane[:2];result[-2:]=plane[-2:]
    result[:,:2]=plane[:,:2];result[:,-2:]=plane[:,-2:]
    return result
