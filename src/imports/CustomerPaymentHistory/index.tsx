import svgPaths from "./svg-dyweyyq0kf";

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

function IconArrowLeft() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[16px]" data-name="icon-arrow-left">
      <ArrowLeft />
    </div>
  );
}

function BackCta() {
  return (
    <div className="content-stretch flex gap-[4px] items-center relative shrink-0" data-name="back-cta">
      <IconArrowLeft />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Profile</p>
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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">Payment History</p>
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

function AvatarPlaceholder() {
  return (
    <div className="relative shrink-0 size-[34px]" data-name="avatar-placeholder">
      <svg className="absolute block inset-0 size-full" fill="none" height="34" preserveAspectRatio="none" viewBox="0 0 34 34" width="34">
        <g id="avatar-placeholder">
          <rect fill="#F5F5F5" height="33" rx="16.5" width="33" x="0.5" y="0.5" />
          <rect height="33" rx="16.5" stroke="#E5E5E5" width="33" x="0.5" y="0.5" />
          <path d={svgPaths.p1d4b9e00} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function UserProfile() {
  return (
    <div className="content-stretch flex flex-[1_0_0] gap-[8px] items-center min-w-px relative" data-name="user-profile">
      <AvatarPlaceholder />
      <p className="[word-break:break-word] font-['Rubik:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">Rashid Ali</p>
    </div>
  );
}

function Frame1() {
  return (
    <div className="content-stretch flex items-center relative shrink-0 w-full">
      <UserProfile />
      <p className="[word-break:break-word] font-['Rubik:Medium',sans-serif] font-medium leading-[0] relative shrink-0 text-[#888] text-[0px] whitespace-nowrap">
        <span className="font-['Rubik:Regular',sans-serif] font-normal leading-[normal] text-[12px]">Credit Health:</span>
        <span className="leading-[normal] text-[12px]">{` `}</span>
        <span className="leading-[normal] text-[#2e7d32] text-[12px]">Good</span>
      </p>
    </div>
  );
}

function MetricOutstanding() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2px] items-start leading-[normal] min-w-px relative whitespace-nowrap" data-name="metric-outstanding">
      <p className="font-['Rubik:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px] tracking-[0.5px] uppercase">Outstanding Credit</p>
      <p className="font-['Geist:SemiBold',sans-serif] font-semibold relative shrink-0 text-[16px] text-black">Rs. 12,400</p>
    </div>
  );
}

function MetricCart() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2px] items-start leading-[normal] min-w-px pl-[16px] relative whitespace-nowrap" data-name="metric-cart">
      <p className="font-['Rubik:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px] tracking-[0.5px] uppercase">Credit Limit</p>
      <p className="font-['Geist:SemiBold',sans-serif] font-semibold relative shrink-0 text-[16px] text-black">Rs. 50,000</p>
    </div>
  );
}

function MetricsRow() {
  return (
    <div className="content-stretch flex items-center justify-between px-[10px] relative shrink-0 w-full" data-name="metrics-row">
      <MetricOutstanding />
      <div className="flex h-[24px] items-center justify-center relative shrink-0 w-0">
        <div className="flex-none rotate-90">
          <div className="h-0 relative w-[24px]" data-name="Line">
            <div className="absolute inset-[-1px_0_0_0]">
              <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 24 1" width="24">
                <line id="Line" stroke="#F0F0F0" x2="24" y1="0.5" y2="0.5" />
              </svg>
            </div>
          </div>
        </div>
      </div>
      <MetricCart />
    </div>
  );
}

function CustomerHeaderV2Card() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-col gap-[12px] items-start px-[16px] py-[8px] relative shrink-0 w-full" data-name="customer-header-v2-card">
      <Frame1 />
      <MetricsRow />
    </div>
  );
}

function PaymentMeta() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-meta">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Aug 10, 2026</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">Method: Cash</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Rec: Ahmed</p>
    </div>
  );
}

function PaymentValues() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-end leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-values">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">-Rs. 5,000</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">Bal: Rs. 13,200</p>
    </div>
  );
}

function PaymentRow() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="payment-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <PaymentMeta />
      <PaymentValues />
    </div>
  );
}

function PaymentMeta1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-meta">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Jul 28, 2026</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">Method: Bank Transfer</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Rec: Ahmed</p>
    </div>
  );
}

function PaymentValues1() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-end leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-values">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">-Rs. 15,000</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">Bal: Rs. 18,200</p>
    </div>
  );
}

function PaymentRow1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="payment-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <PaymentMeta1 />
      <PaymentValues1 />
    </div>
  );
}

function PaymentMeta2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-meta">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Jul 05, 2026</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">Method: Cash</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Rec: Ahmed</p>
    </div>
  );
}

function PaymentValues2() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-end leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-values">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">-Rs. 3,000</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">Bal: Rs. 33,200</p>
    </div>
  );
}

function PaymentRow2() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="payment-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <PaymentMeta2 />
      <PaymentValues2 />
    </div>
  );
}

function PaymentMeta3() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-meta">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">Jun 18, 2026</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">Method: Cash</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Rec: Ahmed</p>
    </div>
  );
}

function PaymentValues3() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-end leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-values">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">-Rs. 10,000</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">Bal: Rs. 36,200</p>
    </div>
  );
}

function PaymentRow3() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="payment-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <PaymentMeta3 />
      <PaymentValues3 />
    </div>
  );
}

function PaymentMeta4() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-meta">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">May 30, 2026</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[13px]">Method: Bank Transfer</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[12px]">Rec: Ahmed</p>
    </div>
  );
}

function PaymentValues4() {
  return (
    <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-end leading-[normal] relative shrink-0 whitespace-nowrap" data-name="payment-values">
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[14px] text-black">-Rs. 8,500</p>
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[11px]">Bal: Rs. 46,200</p>
    </div>
  );
}

function PaymentRow4() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="payment-row">
      <div aria-hidden className="absolute border-0 border-[#e5e5e5] border-solid inset-0 pointer-events-none" />
      <PaymentMeta4 />
      <PaymentValues4 />
    </div>
  );
}

function ListContainer() {
  return (
    <div className="relative rounded-[12px] shrink-0 w-full" data-name="list-container">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <PaymentRow />
        <PaymentRow1 />
        <PaymentRow2 />
        <PaymentRow3 />
        <PaymentRow4 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function PaymentsList() {
  return (
    <div className="content-stretch flex flex-col items-start p-[16px] relative shrink-0 w-full" data-name="payments-list">
      <ListContainer />
    </div>
  );
}

function PaymentHistoryBody() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="payment-history-body">
      <StatusBar />
      <ScreenHeader />
      <CustomerHeaderV2Card />
      <PaymentsList />
    </div>
  );
}

function Home() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="home">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="home">
          <path d={svgPaths.p2046d6b0} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconHome() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-home">
      <Home />
    </div>
  );
}

function TabHome() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Home">
      <IconHome />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Home</p>
    </div>
  );
}

function NewSale() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="new-sale">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="new-sale">
          <path d={svgPaths.p1f68d100} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconNewSale() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-new-sale">
      <NewSale />
    </div>
  );
}

function TabNewSale() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-New Sale">
      <IconNewSale />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">New Sale</p>
    </div>
  );
}

function Sales() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="sales">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="sales">
          <path d={svgPaths.p157d680} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconSales() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-sales">
      <Sales />
    </div>
  );
}

function TabSales() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Sales">
      <IconSales />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Sales</p>
    </div>
  );
}

function Customers() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="customers">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="customers">
          <path d={svgPaths.p39d26d00} id="Vector" stroke="black" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconCustomers() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-customers">
      <Customers />
    </div>
  );
}

function TabCustomers() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Customers">
      <IconCustomers />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[10px] text-black whitespace-nowrap">Customers</p>
    </div>
  );
}

function Products() {
  return (
    <div className="relative shrink-0 size-[20px]" data-name="products">
      <svg className="absolute block inset-0 size-full" fill="none" height="20" preserveAspectRatio="none" viewBox="0 0 20 20" width="20">
        <g id="products">
          <path d={svgPaths.p18b82200} id="Vector" stroke="#888888" strokeLinecap="round" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

function IconProducts() {
  return (
    <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative shrink-0 size-[20px]" data-name="icon-products">
      <Products />
    </div>
  );
}

function TabProducts() {
  return (
    <div className="content-stretch flex flex-col gap-[4px] items-center justify-center relative shrink-0 w-[64px]" data-name="tab-Products">
      <IconProducts />
      <p className="[word-break:break-word] font-['Geist:Medium',sans-serif] font-medium leading-[normal] relative shrink-0 text-[#888] text-[10px] whitespace-nowrap">Products</p>
    </div>
  );
}

function NavTabs() {
  return (
    <div className="content-stretch flex h-[64px] items-center justify-between px-[16px] relative shrink-0 w-full" data-name="nav-tabs">
      <TabHome />
      <TabNewSale />
      <TabSales />
      <TabCustomers />
      <TabProducts />
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

function BottomNav() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="bottom-nav">
      <div aria-hidden className="absolute border-[#e5e5e5] border-solid border-t inset-0 pointer-events-none" />
      <NavTabs />
      <HomeIndicator />
    </div>
  );
}

export default function CustomerPaymentHistory() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="customer-payment-history">
      <PaymentHistoryBody />
      <BottomNav />
    </div>
  );
}