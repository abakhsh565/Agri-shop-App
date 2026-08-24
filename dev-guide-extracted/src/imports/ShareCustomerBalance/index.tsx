import svgPaths from "./svg-amf5ayq42l";

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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Share Balance Summary</p>
    </div>
  );
}

function Frame() {
  return <div className="h-px relative shrink-0 w-[40px]" data-name="Frame" />;
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <HeaderTitles />
      <Frame />
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

function AvatarMock() {
  return (
    <div className="bg-black content-stretch flex items-center justify-center relative rounded-[20px] shrink-0 size-[40px]" data-name="avatar-mock">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-white whitespace-nowrap">RA</p>
    </div>
  );
}

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[2px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[16px] text-black">Rashid Ali</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">0300-1234567 • Faisalabad</p>
    </div>
  );
}

function CustomerSummaryRow() {
  return (
    <div className="bg-[#f5faf5] content-stretch flex gap-[12px] items-center p-[16px] relative shrink-0 w-full" data-name="customer-summary-row">
      <AvatarMock />
      <Frame1 />
    </div>
  );
}

function Frame2() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[13px] w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Total Purchases</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Rs. 85,400</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[13px] w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Total Paid</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-black">Rs. 72,200</p>
    </div>
  );
}

function Frame4() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-black">Outstanding Balance</p>
      <p className="relative shrink-0 text-[#ff3b30]">Rs. 13,200</p>
    </div>
  );
}

function Frame5() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-start justify-between leading-[normal] relative shrink-0 text-[11px] w-full whitespace-nowrap" data-name="Frame">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888]">Last payment received</p>
      <p className="font-['Geist:Medium',sans-serif] font-medium relative shrink-0 text-black">Rs. 10,000 on Jul 28</p>
    </div>
  );
}

function BalanceCard() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col gap-[12px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="balance-card">
      <Frame2 />
      <Frame3 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 338 1" width="338">
            <line id="Line" stroke="#E5E5E5" x2="338" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <Frame4 />
      <Frame5 />
    </div>
  );
}

function ChatBubble() {
  return (
    <div className="bg-[#e2f4dd] content-stretch flex flex-col font-['Geist:Regular',sans-serif] font-normal gap-[6px] items-start p-[14px] relative rounded-[12px] shrink-0 w-full" data-name="chat-bubble">
      <p className="leading-[1.5] relative shrink-0 text-[13px] text-black w-full">Dear Rashid Ali, your outstanding balance at AgriShop is Rs. 13,200. Last payment: Rs. 10,000 on Jul 28. Please visit us for settlement. Thank you!</p>
      <p className="leading-[normal] relative shrink-0 text-[#888] text-[10px] text-right w-full">Pre-formatted reminder</p>
    </div>
  );
}

function MessagePreviewSec() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="message-preview-sec">
      <p className="font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Message Preview (WhatsApp / SMS)</p>
      <ChatBubble />
    </div>
  );
}

function Content() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="content">
      <BalanceCard />
      <MessagePreviewSec />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <CustomerSummaryRow />
      <Content />
    </div>
  );
}

function Phone() {
  return (
    <div className="relative shrink-0 size-[16px]" data-name="phone">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_7)" id="phone">
          <path d={svgPaths.p29098400} id="Vector" stroke="white" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_7">
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
        <g clipPath="url(#clip0_0_4)" id="copy">
          <path d={svgPaths.p397a8300} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
        <defs>
          <clipPath id="clip0_0_4">
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Copy Message</p>
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

export default function ShareCustomerBalance() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="share-customer-balance">
      <Body />
      <Footer />
    </div>
  );
}