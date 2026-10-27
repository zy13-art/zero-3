#include <cmath>
// Exact same wide, bounded, luminance-only operation as the NumPy reference.
extern "C" __declspec(dllexport) void clarity_v2_luma(
    const unsigned char* src,double* horizontal,unsigned char* dst,int width,int height,double fade) {
    const int coefficients[25]={1,24,276,2024,10626,42504,134596,346104,735471,1307504,1961256,2496144,2704156,2496144,1961256,1307504,735471,346104,134596,42504,10626,2024,276,24,1};
    double kernel[25];for(int k=0;k<25;k++)kernel[k]=(double)coefficients[k]/16777216.;
    #pragma omp parallel for num_threads(6)
    for(int y=0;y<height;y++) {
        for(int x=0;x<width;x++) {
            double value=0;
            for(int k=0;k<25;k++) {int xx=x+k-12;if(xx<0)xx=0;if(xx>=width)xx=width-1;value=value+(double)src[y*width+xx]*kernel[k];}
            horizontal[y*width+x]=value;
        }
    }
    int bottom=height*5/6;if(bottom>height-2)bottom=height-2;
    #pragma omp parallel for num_threads(6)
    for(int y=2;y<bottom;y++) {
        for(int x=2;x<width-2;x++) {
            int index=y*width+x;double blur=0;
            for(int k=0;k<25;k++) {int yy=y+k-12;if(yy<0)yy=0;if(yy>=height)yy=height-1;blur=blur+horizontal[yy*width+x]*kernel[k];}
            int low=src[index],high=src[index];
            for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++) {int value=src[index+dy*width+dx];if(value<low)low=value;if(value>high)high=value;}
            double detail=(double)src[index]-blur,absolute=std::abs(detail);
            double spread=(double)(high-low)/128.,weight=1./(1.+spread*spread*spread*spread);
            double delta=detail*(absolute/(absolute+.75))*1.15*weight*fade;
            if(delta>10.)delta=10.;if(delta<-10.)delta=-10.;
            double value=(double)src[index]+delta;if(value<low)value=(double)low;if(value>high)value=(double)high;
            int rounded=(int)value;double fraction=value-rounded;
            if(fraction>.5 || (fraction==.5 && (rounded&1)))rounded++;
            if(src[index]>0 && rounded==0)rounded=1;if(src[index]<255 && rounded==255)rounded=254;
            dst[index]=(unsigned char)rounded;
        }
    }
}
