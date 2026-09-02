import { Button, ButtonProps } from "@/components/ui/button";

export function PrimaryButton(props: ButtonProps) {
  return <Button {...props} className={`btn-primary ${props.className ?? ""}`} />;
}
