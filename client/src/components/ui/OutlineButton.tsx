import { Button, ButtonProps } from "@/components/ui/button";

export function OutlineButton(props: ButtonProps) {
  return <Button {...props} className={`btn-outline ${props.className ?? ""}`} />;
}
