import svgPaths from "./svg-yxkud3eq49";
import imgLine from "./b7a6208b92a16cbecef1af262bb62a0199fc82cc.png";

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

function ArrowLeft() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="arrow-left">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g id="arrow-left">
          <path d={svgPaths.pe197860} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <ArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Back</p>
    </div>
  );
}

function HeaderTitles() {
  return (
    <div className="content-stretch flex flex-col items-center relative shrink-0" data-name="header-titles">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Receipt #1042</p>
    </div>
  );
}

function Share() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="share">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="share">
          <path d={svgPaths.p34088a00} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function ShareAction() {
  return (
    <div className="content-stretch flex items-center justify-center relative shrink-0 size-[40px]" data-name="share-action">
      <Share />
    </div>
  );
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <HeaderTitles />
      <ShareAction />
    </div>
  );
}

function ScreenHeader() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="screen-header">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <HeaderRow />
    </div>
  );
}

function Frame() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-center leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[22px] text-black">AgriShop</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Faisalabad, Punjab</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Aug 8, 2026 — 2:34 PM</p>
    </div>
  );
}

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[13px] w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Customer</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Rashid Ali</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-start justify-between relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0">Item</p>
      <p className="relative shrink-0">Total</p>
    </div>
  );
}

function Frame4() {
  return (
    <div className="content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-start justify-between py-[2px] relative shrink-0 w-full" data-name="Frame">
      <p className="relative shrink-0 w-[220px]">Janja Spray 500ml x 3</p>
      <p className="relative shrink-0 whitespace-nowrap">Rs. 4,200</p>
    </div>
  );
}

function Frame5() {
  return (
    <div className="content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-start justify-between py-[2px] relative shrink-0 w-full" data-name="Frame">
      <p className="relative shrink-0 w-[220px]">Wheat Seeds 5kg x 1</p>
      <p className="relative shrink-0 whitespace-nowrap">Rs. 5,000</p>
    </div>
  );
}

function Frame2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-start leading-[normal] relative shrink-0 text-[13px] text-black w-full" data-name="Frame">
      <Frame3 />
      <Frame4 />
      <Frame5 />
    </div>
  );
}

function Frame7() {
  return (
    <div className="content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-start justify-between relative shrink-0 text-[13px] w-full" data-name="Frame">
      <p className="relative shrink-0 text-[#888]">Subtotal</p>
      <p className="relative shrink-0 text-black">Rs. 9,200</p>
    </div>
  );
}

function Frame8() {
  return (
    <div className="content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-start justify-between relative shrink-0 text-[15px] text-black w-full" data-name="Frame">
      <p className="relative shrink-0">Total due</p>
      <p className="relative shrink-0">Rs. 9,200</p>
    </div>
  );
}

function Frame9() {
  return (
    <div className="content-stretch flex items-start justify-between relative shrink-0 text-[13px] w-full" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Paid Amount</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Rs. 7,000</p>
    </div>
  );
}

function Frame10() {
  return (
    <div className="content-stretch flex items-start justify-between relative shrink-0 text-[13px] w-full" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Outstanding Balance</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[#ff3b30]">Rs. 2,200</p>
    </div>
  );
}

function Frame6() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[6px] items-start leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="Frame">
      <Frame7 />
      <Frame8 />
      <Frame9 />
      <Frame10 />
    </div>
  );
}

function Frame11() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-start justify-between leading-[normal] relative shrink-0 text-[#888] text-[11px] w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0">Sold by: Ahmed</p>
      <p className="relative shrink-0">Thank you for your business!</p>
    </div>
  );
}

function ReceiptSlip() {
  return (
    <div className="content-stretch flex flex-col gap-[16px] items-start p-[24px] relative rounded-[16px] shrink-0 w-full" data-name="receipt-slip">
      <div aria-hidden className="absolute border-[1.5px] border-black border-dashed inset-0 pointer-events-none rounded-[16px]" />
      <Frame />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 322 1" width="322">
            <line id="Line" stroke="#E5E5E5" x2="322" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <Frame1 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 322 1" width="322">
            <line id="Line" stroke="#E5E5E5" x2="322" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <Frame2 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <img alt="" className="block max-w-none size-full" height="1" src={imgLine} width="322" />
        </div>
      </div>
      <Frame6 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 322 1" width="322">
            <line id="Line" stroke="#E5E5E5" x2="322" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <Frame11 />
    </div>
  );
}

function Content() {
  return (
    <div className="content-stretch flex flex-col items-start p-[16px] relative shrink-0 w-full" data-name="content">
      <ReceiptSlip />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <Content />
    </div>
  );
}

function Phone() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="phone">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_10)" id="phone">
          <path d={svgPaths.p29098400} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_10">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Btn() {
  return (
    <div className="bg-black content-stretch flex gap-[8px] h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn">
      <Phone />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Share via WhatsApp</p>
    </div>
  );
}

function Copy() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="copy">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_6)" id="copy">
          <path d={svgPaths.p397a8300} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_6">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Btn1() {
  return (
    <div className="bg-white content-stretch flex gap-[8px] h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <Copy />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Copy to Clipboard</p>
    </div>
  );
}

function HomeIndicator() {
  return (
    <div className="content-stretch flex items-start justify-center py-[8px] relative shrink-0 w-full" data-name="home-indicator">
      <div className="bg-black h-[5px] relative rounded-[100px] shrink-0 w-[139px]" data-name="indicator-bar" />
    </div>
  );
}

function Footer() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="footer">
      <Btn />
      <Btn1 />
      <HomeIndicator />
    </div>
  );
}

export default function ShareReceipt() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="share-receipt">
      <Body />
      <Footer />
    </div>
  );
}