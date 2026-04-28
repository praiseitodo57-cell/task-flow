import supabase from "../config/supabase.js"

export const register = async (req, res) => {

  const { email, password } = req.body

  const { data, error } = await supabase.auth.signUp({
    email,
    password
  })

  if (error) {
    return res.status(400).json({
      error: error.message
    })
  }

  res.status(201).json({
    message: "User registered successfully",
    user: data.user
  })
}