import svgPaths from "./svg-2a40028r7t";

function Signal() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="signal">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_10)" id="signal">
          <path clipRule="evenodd" d={svgPaths.p159df970} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_10">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Wifi() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="wifi">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g clipPath="url(#clip0_0_8)" id="wifi">
          <path clipRule="evenodd" d={svgPaths.p18941500} fill="black" fillRule="evenodd" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_8">
            <rect fill="white" height="20" width="20" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Battery() {
  return (
    <div className="h-[20px] relative shrink-0 w-[28px]" data-name="battery">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 28 20" width="28">
        <g clipPath="url(#clip0_0_6)" id="battery">
          <path d={svgPaths.p7132ff1} fill="black" id="Vector" />
        </g>
        <defs>
          <clipPath id="clip0_0_6">
            <rect fill="white" height="20" width="28" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="content-stretch flex gap-[6px] items-center relative shrink-0" data-name="status-icons">
      <Signal />
      <Wifi />
      <Battery />
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
    <div className="relative shrink-0 size-[16px]" data-name="arrowLeft">
      <svg className="absolute block inset-0 size-full" fill="none" height="16" preserveAspectRatio="none" viewBox="0 0 16 16" width="16">
        <g clipPath="url(#clip0_0_4)" id="arrowLeft">
          <g id="Vector" />
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

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <ArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Employees</p>
    </div>
  );
}

function Frame() {
  return <div className="h-px relative shrink-0 w-[60px]" data-name="Frame" />;
}

function HeaderRow() {
  return (
    <div className="content-stretch flex h-[56px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="header-row">
      <BackCta />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Ahmed Khan</p>
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

function AvatarRing() {
  return (
    <div className="bg-black content-stretch flex flex-col items-center justify-center relative rounded-[32px] shrink-0 size-[64px]" data-name="avatar-ring">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[24px] text-white whitespace-nowrap">AK</p>
    </div>
  );
}

function Info() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-center leading-[normal] relative shrink-0 whitespace-nowrap" data-name="info">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[18px] text-black">Ahmed Khan</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">Sales Executive • Active</p>
    </div>
  );
}

function ProfileCard() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col gap-[12px] items-center p-[20px] relative shrink-0 w-full" data-name="profile-card">
      <AvatarRing />
      <Info />
    </div>
  );
}

function Kpi() {
  return (
    <div className="content-stretch flex flex-[1_0_26px] flex-col gap-[4px] items-start min-w-px p-[12px] relative rounded-[8px]" data-name="kpi">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">MONTH SALES</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">Rs. 85,000</p>
    </div>
  );
}

function Kpi1() {
  return (
    <div className="content-stretch flex flex-[1_0_26px] flex-col gap-[4px] items-start min-w-px p-[12px] relative rounded-[8px]" data-name="kpi">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">TRANSACTIONS</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">24 Sales</p>
    </div>
  );
}

function Row1() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="row-1">
      <Kpi />
      <Kpi1 />
    </div>
  );
}

function Kpi2() {
  return (
    <div className="content-stretch flex flex-[1_0_26px] flex-col gap-[4px] items-start min-w-px p-[12px] relative rounded-[8px]" data-name="kpi">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">CUSTOMERS</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">18 Served</p>
    </div>
  );
}

function Kpi3() {
  return (
    <div className="content-stretch flex flex-[1_0_26px] flex-col gap-[4px] items-start min-w-px p-[12px] relative rounded-[8px]" data-name="kpi">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[8px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">CREDIT SALES</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">Rs. 15,200</p>
    </div>
  );
}

function Row2() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="row-2">
      <Kpi2 />
      <Kpi3 />
    </div>
  );
}

function PerformanceGrid() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="performance-grid">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase whitespace-nowrap">Performance Summary (Current Month)</p>
      <Row1 />
      <Row2 />
    </div>
  );
}

function Row() {
  return (
    <div className="content-stretch flex items-center justify-between p-[12px] relative shrink-0 w-full" data-name="row">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Rashid Ali</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Rs. 9,200</p>
    </div>
  );
}

function Row3() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] p-[12px] relative shrink-0 text-[13px] text-black w-full whitespace-nowrap" data-name="row">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0">Muhammad Asif</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 14,000</p>
    </div>
  );
}

function List() {
  return (
    <div className="relative rounded-[8px] shrink-0 w-full" data-name="list">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <Row />
        <Row3 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[8px]" />
    </div>
  );
}

function RecentSales() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start p-[16px] relative shrink-0 w-full" data-name="recent-sales">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase whitespace-nowrap">Recent Submissions</p>
      <List />
    </div>
  );
}

function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="body">
      <StatusBar />
      <ScreenHeader />
      <ProfileCard />
      <PerformanceGrid />
      <RecentSales />
    </div>
  );
}

function BtnEdit() {
  return (
    <div className="content-stretch flex h-[44px] items-center justify-center relative rounded-[22px] shrink-0 w-full" data-name="btn-edit">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[22px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Edit Details</p>
    </div>
  );
}

function BtnDeactivate() {
  return (
    <div className="bg-[#fce8e6] content-stretch flex h-[44px] items-center justify-center relative rounded-[22px] shrink-0 w-full" data-name="btn-deactivate">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[22px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[13px] text-black whitespace-nowrap">Deactivate Profile</p>
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
      <BtnEdit />
      <BtnDeactivate />
      <HomeIndicator />
    </div>
  );
}

export default function EmployeeDetail() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="employee-detail">
      <Body />
      <Footer />
    </div>
  );
}