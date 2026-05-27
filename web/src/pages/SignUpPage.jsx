import { SignUp } from '@clerk/clerk-react'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" appearance={{ baseTheme: undefined }} />
    </div>
  )
}
