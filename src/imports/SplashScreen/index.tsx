import svgPaths from "./svg-2uzivxxcvj";

function IosSignal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="ios-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="ios-signal">
          <path clipRule="evenodd" d={svgPaths.p2bb6eb80} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosWifiSignal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="ios-wifi-signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="ios-wifi-signal">
          <path clipRule="evenodd" d={svgPaths.p646c5c0} fill="black" fillRule="evenodd" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function IosBatteryFull() {
  return (
    <div className="h-[20px] relative shrink-0 w-[28px]" data-name="ios-battery-full">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 28 20" width="28">
        <g id="ios-battery-full">
          <path d={svgPaths.p66c9640} fill="black" id="Vector" />
        </g>
      </svg>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="status-icons">
      <IosSignal />
      <IosWifiSignal />
      <IosBatteryFull />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="content-stretch flex h-[44px] items-center justify-between px-[24px] relative shrink-0 w-full" data-name="status-bar">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">9:41</p>
      <StatusIcons />
    </div>
  );
}

function Sprout() {
  return (
    <div className="relative shrink-0 size-[40px]" data-name="sprout">
      <svg className="absolute block inset-0 size-full" fill="none" height="40" preserveAspectRatio="none" viewBox="0 0 40 40" width="40">
        <g id="sprout">
          <path d={svgPaths.p29999800} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconSprout() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[40px]" data-name="icon-sprout">
      <Sprout />
    </div>
  );
}

function AppLogo() {
  return (
    <div className="bg-black content-stretch flex flex-col items-center justify-center relative rounded-[40px] shrink-0 size-[80px]" data-name="app-logo">
      <IconSprout />
    </div>
  );
}

function SplashTitles() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-center leading-[normal] relative shrink-0 text-center w-full whitespace-nowrap" data-name="splash-titles">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[32px] text-black">AgriShop</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[14px]">Smart Retail for Agriculture</p>
    </div>
  );
}

function SplashBody() {
  return (
    <div className="content-stretch flex flex-col gap-[24px] items-center justify-center py-[120px] relative shrink-0 w-full" data-name="splash-body">
      <AppLogo />
      <SplashTitles />
    </div>
  );
}

function SplashFooter() {
  return (
    <div className="content-stretch flex flex-col items-center p-[24px] relative shrink-0 w-full" data-name="splash-footer">
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Employee Facing App</p>
    </div>
  );
}

export default function SplashScreen() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="splash-screen">
      <StatusBar />
      <SplashBody />
      <SplashFooter />
    </div>
  );
}