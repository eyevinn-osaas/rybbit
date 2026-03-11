import { authClient } from "@/lib/auth";
import { ArrowRight } from "lucide-react";
import { useExtracted } from "next-intl";
import { useRouter } from "next/navigation";
import { DEFAULT_EVENT_LIMIT } from "../../lib/subscription/constants";
import { useStripeSubscription } from "../../lib/subscription/useStripeSubscription";
import { Button } from "../ui/button";
import { UsageChart } from "../UsageChart";
import { PlanCard } from "./components/PlanCard";
import { UsageLimitAlerts } from "./components/UsageLimitAlerts";
import { UsageProgressBar } from "./components/UsageProgressBar";
import { useUsageStats } from "./components/useUsageStats";

export function FreePlan() {
  const t = useExtracted();
  const { data: subscription } = useStripeSubscription();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const router = useRouter();

  const organizationId = activeOrg?.id;
  const { currentUsage, limit, percentageUsed, isNearLimit, isLimitExceeded } = useUsageStats(subscription);

  if (!subscription) return null;

  return (
    <PlanCard
      title={t("Free Plan")}
      description={t("You are on the Free plan with up to {limit} pageviews per month.", { limit: DEFAULT_EVENT_LIMIT.toLocaleString() })}
      footer={
        <Button onClick={() => router.push("/subscribe")} variant={"success"}>
          {t("Upgrade To Pro")} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      }
    >
      <UsageLimitAlerts
        isLimitExceeded={isLimitExceeded}
        isNearLimit={isNearLimit}
        exceededMessage={t("You have exceeded your monthly event limit. Please upgrade to a Pro plan to continue collecting analytics.")}
      />
      <UsageProgressBar
        currentUsage={currentUsage}
        limit={limit}
        percentageUsed={percentageUsed}
        isNearLimit={isNearLimit}
      />
      {organizationId && <UsageChart organizationId={organizationId} />}
    </PlanCard>
  );
}
