import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const data = [
  { month: "Jan", earnings: 320 },
  { month: "Feb", earnings: 480 },
  { month: "Mar", earnings: 290 },
  { month: "Apr", earnings: 610 },
  { month: "May", earnings: 520 },
  { month: "Jun", earnings: 627 },
];

export function EarningsChart() {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="font-display text-lg">Earnings History</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="earnGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" stroke="hsl(215,15%,55%)" fontSize={12} />
            <YAxis stroke="hsl(215,15%,55%)" fontSize={12} />
            <Tooltip contentStyle={{ background: "hsl(220, 18%, 10%)", border: "1px solid hsl(220, 14%, 18%)", borderRadius: "8px" }} />
            <Area type="monotone" dataKey="earnings" stroke="hsl(142, 71%, 45%)" fill="url(#earnGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
