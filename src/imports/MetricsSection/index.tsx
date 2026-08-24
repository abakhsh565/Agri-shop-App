function MetricCard() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Total Sales</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 1,25,400</p>
    </div>
  );
}

function MetricCard1() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Transactions</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">34</p>
    </div>
  );
}

function GridRow() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="grid-row-1">
      <MetricCard />
      <MetricCard1 />
    </div>
  );
}

function Frame() {
  return (
    <div className="[word-break:break-word] content-stretch flex font-['Geist:Regular',sans-serif] font-normal gap-[4px] items-center leading-[normal] relative shrink-0 text-[11px] whitespace-nowrap" data-name="Frame">
      <p className="relative shrink-0 text-[#888] uppercase">Gross Profit</p>
      <p className="relative shrink-0 text-black">▲</p>
    </div>
  );
}

function MetricCard2() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <Frame />
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 28,600</p>
    </div>
  );
}

function MetricCard3() {
  return (
    <div className="bg-white content-stretch flex flex-[1_0_34px] flex-col gap-[8px] items-start min-w-px p-[16px] relative rounded-[12px]" data-name="metric-card">
      <div aria-hidden className="absolute border border-black border-solid inset-0 pointer-events-none rounded-[12px]" />
      <p className="[word-break:break-word] font-['Geist:Regular',sans-serif] font-normal leading-[normal] relative shrink-0 text-[#888] text-[11px] uppercase whitespace-nowrap">Outstanding Credit</p>
      <p className="[word-break:break-word] font-['Geist:Bold',sans-serif] font-bold leading-[normal] relative shrink-0 text-[20px] text-black whitespace-nowrap">Rs. 48,200</p>
    </div>
  );
}

function GridRow1() {
  return (
    <div className="content-stretch flex gap-[12px] items-start relative shrink-0 w-full" data-name="grid-row-2">
      <MetricCard2 />
      <MetricCard3 />
    </div>
  );
}

function MetricCardHalf() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px p-[12px] relative rounded-[8px]" data-name="metric-card-half">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[10px] uppercase">Paid Sales</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[15px] text-black">Rs. 77,200</p>
    </div>
  );
}

function MetricCardHalf1() {
  return (
    <div className="bg-[#f5f5f5] content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px p-[12px] relative rounded-[8px]" data-name="metric-card-half">
      <p className="font-['Geist:Regular',sans-serif] font-normal relative shrink-0 text-[#888] text-[10px] uppercase">Credit Sales</p>
      <p className="font-['Geist:Bold',sans-serif] font-bold relative shrink-0 text-[15px] text-black">Rs. 48,200</p>
    </div>
  );
}

function GridRowSplit() {
  return (
    <div className="[word-break:break-word] content-stretch flex gap-[12px] items-start leading-[normal] relative shrink-0 w-full whitespace-nowrap" data-name="grid-row-split">
      <MetricCardHalf />
      <MetricCardHalf1 />
    </div>
  );
}

export default function MetricsSection() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] items-start pb-[12px] px-[16px] relative size-full" data-name="metrics-section">
      <GridRow />
      <GridRow1 />
      <GridRowSplit />
    </div>
  );
}