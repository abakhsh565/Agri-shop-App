import svgPaths from "./svg-wkxxw78yoh";

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
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[16px] text-black text-center whitespace-nowrap">{`Review & Payment`}</p>
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

function Frame5() {
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
    <div className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2px] items-start leading-[normal] min-w-px ps-[16px] relative whitespace-nowrap" data-name="metric-cart">
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
      <Frame5 />
      <MetricsRow />
    </div>
  );
}

function RowOne() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] relative shrink-0 text-[16px] text-black w-full whitespace-nowrap" data-name="row-one">
      <p className="font-['Geist:SemiBold',sans-serif] font-semibold relative shrink-0">Janja Spray</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 4,200</p>
    </div>
  );
}

function Action() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="Action">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="Action">
          <path d={svgPaths.p16b6ae00} fill="#F0F3F4" />
          <path d="M11 16H21" id="Vector" stroke="black" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function Action1() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="Action">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="Action">
          <path d={svgPaths.p16b6ae00} fill="#F0F3F4" />
          <path d="M11 16H21M16 11V21" id="Vector" stroke="black" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function QuantitySelector() {
  return (
    <div className="content-stretch flex items-center justify-between p-[2px] relative rounded-[34px] shrink-0 w-[112px]" data-name="Quantity selector">
      <div aria-hidden className="absolute border border-[#f2f4f5] border-solid inset-0 pointer-events-none rounded-[34px]" />
      <Action />
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">2</p>
      <Action1 />
    </div>
  );
}

function Frame4() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full">
      <p className="[word-break:break-word] flex-[1_0_0] font-['Geist:Regular',sans-serif] font-normal leading-[normal] min-w-px relative text-[#888] text-[12px]">500ml - Rs. 2100 × 2</p>
      <QuantitySelector />
    </div>
  );
}

function ItemMeta() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[8px] items-start min-w-px relative" data-name="item-meta">
      <RowOne />
      <Frame4 />
    </div>
  );
}

function ItemRow() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="item-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <ItemMeta />
    </div>
  );
}

function RowOne1() {
  return (
    <div className="[word-break:break-word] content-stretch flex items-center justify-between leading-[normal] relative shrink-0 text-[16px] text-black w-full whitespace-nowrap" data-name="row-one">
      <p className="font-['Geist:SemiBold',sans-serif] font-semibold relative shrink-0">Janja Spray</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0">Rs. 1500</p>
    </div>
  );
}

function Action2() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="Action">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="Action">
          <path d={svgPaths.p16b6ae00} fill="#FFEDED" />
          <path d={svgPaths.p20ef8e00} id="Vector" stroke="#C32A0B" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function Action3() {
  return (
    <div className="relative shrink-0 size-[32px]" data-name="Action">
      <svg className="absolute block inset-0 size-full" fill="none" height="32" preserveAspectRatio="none" viewBox="0 0 32 32" width="32">
        <g id="Action">
          <path d={svgPaths.p16b6ae00} fill="#F0F3F4" />
          <path d="M11 16H21M16 11V21" id="Vector" stroke="black" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function QuantitySelector1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[2px] relative rounded-[34px] shrink-0 w-[112px]" data-name="Quantity selector">
      <div aria-hidden className="absolute border border-[#f2f4f5] border-solid inset-0 pointer-events-none rounded-[34px]" />
      <Action2 />
      <p className="[word-break:break-word] font-['Geist:SemiBold',sans-serif] font-semibold leading-[normal] relative shrink-0 text-[16px] text-black whitespace-nowrap">1</p>
      <Action3 />
    </div>
  );
}

function Frame6() {
  return (
    <div className="content-stretch flex items-center justify-between relative shrink-0 w-full">
      <p className="[word-break:break-word] flex-[1_0_0] font-['Geist:Regular',sans-serif] font-normal leading-[normal] min-w-px relative text-[#888] text-[12px]">1 Liter - Rs. 1500 × 1</p>
      <QuantitySelector1 />
    </div>
  );
}

function ItemMeta1() {
  return (
    <div className="content-stretch flex flex-[1_0_0] flex-col gap-[8px] items-start min-w-px relative" data-name="item-meta">
      <RowOne1 />
      <Frame6 />
    </div>
  );
}

function ItemRow1() {
  return (
    <div className="content-stretch flex items-center justify-between p-[16px] relative shrink-0 w-full" data-name="item-row">
      <div aria-hidden className="absolute border-[#e5e5e5] border-b border-solid inset-0 pointer-events-none" />
      <ItemMeta1 />
    </div>
  );
}

function CartItems() {
  return (
    <div className="relative rounded-[12px] shrink-0 w-full" data-name="cart-items">
      <div className="content-stretch flex flex-col items-start overflow-clip relative rounded-[inherit] size-full">
        <ItemRow />
        <ItemRow1 />
      </div>
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[12px]" />
    </div>
  );
}

function BtnSecondary() {
  return (
    <div className="content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-secondary">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">+ Add More Products</p>
    </div>
  );
}

function PillFull() {
  return (
    <div className="content-stretch flex flex-[1_0_4px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-full">
      <div aria-hidden className="absolute border-2 border-black border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black whitespace-nowrap">Full Payment</p>
    </div>
  );
}

function PillPartial() {
  return (
    <div className="content-stretch flex flex-[1_0_2px] h-[40px] items-center justify-center min-w-px relative rounded-[20px]" data-name="pill-partial">
      <div aria-hidden className="absolute border border-[#e5e5e5] border-solid inset-0 pointer-events-none rounded-[20px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[#888] text-[12px] whitespace-nowrap">Partial / Credit</p>
    </div>
  );
}

function TypePills() {
  return (
    <div className="content-stretch flex gap-[4px] items-start relative shrink-0 w-full" data-name="type-pills">
      <PillFull />
      <PillPartial />
    </div>
  );
}

function PaymentType() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="payment-type">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase whitespace-nowrap">Payment Type</p>
      <TypePills />
    </div>
  );
}

function Field() {
  return (
    <div className="content-stretch flex h-[48px] items-center px-[16px] relative rounded-[24px] shrink-0 w-full" data-name="field">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[24px]" />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-black whitespace-nowrap">Rs. 9,200</p>
    </div>
  );
}

function InputField() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-full" data-name="input-field">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[12px] text-black uppercase w-full">Amount Received</p>
      <Field />
    </div>
  );
}

function ReceivedInputs() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="received-inputs">
      <InputField />
    </div>
  );
}

function Frame1() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[#ccc]">Subtotal</p>
      <p className="relative shrink-0 text-white">Rs. 9,200</p>
    </div>
  );
}

function Frame2() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Regular',sans-serif] font-normal items-start justify-between leading-[normal] relative shrink-0 text-[14px] w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[#ccc]">Sales Tax (0%)</p>
      <p className="relative shrink-0 text-white">Rs. 0</p>
    </div>
  );
}

function Frame3() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Bold',sans-serif] font-bold items-center justify-between leading-[normal] relative shrink-0 text-white w-full whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[16px]">Total Amount</p>
      <p className="relative shrink-0 text-[20px]">Rs. 9,200</p>
    </div>
  );
}

function ReceiptSummary() {
  return (
    <div className="bg-[#111] content-stretch flex flex-col gap-[12px] items-start p-[16px] relative rounded-[12px] shrink-0 w-full" data-name="receipt-summary">
      <Frame1 />
      <Frame2 />
      <div className="h-0 relative shrink-0 w-full" data-name="Line">
        <div className="absolute inset-[-1px_0_0_0]">
          <svg className="block size-full" fill="none" height="1" preserveAspectRatio="none" viewBox="0 0 338 1" width="338">
            <line id="Line" stroke="#E5E5E5" x2="338" y1="0.5" y2="0.5" />
          </svg>
        </div>
      </div>
      <Frame3 />
    </div>
  );
}

function CartContent() {
  return (
    <div className="content-stretch flex flex-col gap-[20px] items-start p-[16px] relative shrink-0 w-full" data-name="cart-content">
      <CartItems />
      <BtnSecondary />
      <PaymentType />
      <ReceivedInputs />
      <ReceiptSummary />
    </div>
  );
}

function CartBody() {
  return (
    <div className="content-stretch flex flex-col items-start relative shrink-0 w-full" data-name="cart-body">
      <StatusBar />
      <ScreenHeader />
      <CustomerHeaderV2Card />
      <CartContent />
    </div>
  );
}

function BtnPrimary() {
  return (
    <div className="bg-black content-stretch flex h-[48px] items-center justify-center relative rounded-[24px] shrink-0 w-full" data-name="btn-primary">
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[14px] text-white whitespace-nowrap">Proceed to Payment</p>
    </div>
  );
}

function CartFooter() {
  return (
    <div className="content-stretch flex flex-col items-start p-[24px] relative shrink-0 w-full" data-name="cart-footer">
      <BtnPrimary />
    </div>
  );
}

export default function NewSaleCartReview() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start justify-between relative size-full" data-name="new-sale-cart-review">
      <CartBody />
      <CartFooter />
    </div>
  );
}